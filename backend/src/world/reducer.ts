import type { AgentAction, ApplyResult, Commitment, CoordinationOpinion, CoordinationPlan, DecisionReceipt, GateResult, ImpactAssessment, PolicyPack, ResourceLedger, StateDelta, WorldEvent, WorldState } from "../domain.js";
import { runGates, toPolicyPack } from "../rules/gates.js";
import { clamp, clone, deterministicId, digest } from "../util.js";
import { calculatePolicyResources, commitResources, payFiscalResource, releaseResources, requestsFromTerms, reserveResources } from "../rules/tools/resource-ledger.js";

export function applyAction(inputState: WorldState, rawAction: unknown): ApplyResult {
  const state = clone(inputState);
  const gate = runGates(rawAction, state);
  const actionId = gate.action?.actionId ?? inferString(rawAction, "actionId", "invalid_action");
  const actorId = gate.action?.actorId ?? inferString(rawAction, "actorId", "unknown_actor");
  const allPassed = gate.results.every((result) => result.passed);
  if (!allPassed || !gate.action) {
    const receipt: DecisionReceipt = {
      receiptId: deterministicId("receipt", state.runId, actionId, "rejected"),
      actionId,
      actorId,
      status: "REJECTED",
      gateResults: gate.results,
      evidence: [],
      deltas: [],
      worldVersion: state.worldVersion,
    };
    state.receipts.push(receipt);
    const event = eventFor(state, "ActionRejected", actionId, actorId, { gateResults: gate.results });
    state.events.push(event);
    return { state, receipt, events: [event] };
  }

  const action = gate.action;
  const nextVersion = state.worldVersion + 1;
  const deltas: StateDelta[] = [];
  const events: WorldEvent[] = [eventFor(state, "AgentActionProposed", action.actionId, action.actorId, { kind: action.kind })];
  reduceAccepted(state, action, nextVersion, deltas, events, gate.results);
  state.worldVersion = nextVersion;
  state.trace.push(...deltas);
  remember(state, action, deltas);
  const receipt: DecisionReceipt = {
    receiptId: deterministicId("receipt", state.runId, action.actionId, nextVersion),
    actionId: action.actionId,
    actorId: action.actorId,
    status: "APPLIED",
    gateResults: gate.results,
    evidence: buildEvidence(state, action),
    deltas,
    worldVersion: nextVersion,
  };
  state.receipts.push(receipt);
  if (deltas.length > 0) events.push(eventFor({ ...state, worldVersion: nextVersion }, "StateChanged", action.actionId, action.actorId, { deltaIds: deltas.map((delta) => delta.deltaId) }));
  state.events.push(...events);
  return { state, receipt, events };
}

function reduceAccepted(state: WorldState, action: AgentAction, version: number, deltas: StateDelta[], events: WorldEvent[], gateResults: GateResult[]): void {
  switch (action.kind) {
    case "ADVISE_POLICY": {
      const cityId = action.actorId.startsWith("chengdu") ? "chengdu" : "chongqing";
      const before = clone(state.cities[cityId].internalAdvice);
      state.cities[cityId].internalAdvice.push({ actionId: action.actionId, actorId: action.actorId, proposal: action.payload });
      addDelta(deltas, action, version, `cities.${cityId}.internalAdvice`, before, state.cities[cityId].internalAdvice);
      break;
    }
    case "SUBMIT_POLICY_PACK":
    case "REVISE_POLICY_PACK": {
      const calculations = gateResults.find((result) => result.gate === "constraint")?.calculations ?? [];
      const policy = toPolicyPack(action, version, calculations);
      if (action.kind === "REVISE_POLICY_PACK" && policy.supersedesPolicyId) {
        const previous = findPolicy(state, policy.supersedesPolicyId);
        setPolicyStatus(state, previous, "withdrawn", action, version, deltas);
        updateLedger(state, policy.cityId, releaseResources(state.cities[policy.cityId].resourceLedger, requestsFromTerms(previous.terms), "reserved"), action, version, deltas);
        const beforeRevisions = clone(state.cities[policy.cityId].policyRevisions);
        state.cities[policy.cityId].policyRevisions.push({
          revisionId: deterministicId("revision", previous.policyId, policy.policyId),
          cityId: policy.cityId,
          fromPolicyId: previous.policyId,
          toPolicyId: policy.policyId,
          candidateId: policy.candidateId ?? "uncited",
          changedTerms: termDiff(previous.terms, policy.terms),
          createdAtVersion: version,
        });
        addDelta(deltas, action, version, `cities.${policy.cityId}.policyRevisions`, beforeRevisions, state.cities[policy.cityId].policyRevisions);
      }
      const before = clone(state.cities[policy.cityId].policies);
      state.cities[policy.cityId].policies.push(policy);
      addDelta(deltas, action, version, `cities.${policy.cityId}.policies`, before, state.cities[policy.cityId].policies);
      updateLedger(state, policy.cityId, reserveResources(state.cities[policy.cityId].resourceLedger, calculations), action, version, deltas);
      change(state, action, version, deltas, `cities.${policy.cityId}.bidStatus`, state.cities[policy.cityId].bidStatus, action.kind === "REVISE_POLICY_PACK" ? "revising" as const : "competing" as const, (value) => { state.cities[policy.cityId].bidStatus = value; });
      events.push(eventFor({ ...state, worldVersion: version }, "PolicyPackIssued", action.actionId, action.actorId, { policyId: policy.policyId, cityId: policy.cityId, decisionMode: policy.decisionMode }));
      if (policy.decisionMode !== "RETURN_FOR_REVISION" && state.company.projectStage === "courtship") {
        change(state, action, version, deltas, "company.projectStage", state.company.projectStage, "negotiation" as const, (value) => { state.company.projectStage = value; });
      }
      break;
    }
    case "WITHDRAW_CITY_OFFER": {
      const cityId = action.actorId.startsWith("chengdu") ? "chengdu" : "chongqing";
      const city = state.cities[cityId];
      change(state, action, version, deltas, `cities.${cityId}.bidStatus`, city.bidStatus, "withdrawn" as const, (value) => { city.bidStatus = value; });
      for (const policy of city.policies.filter((item) => item.status === "issued")) {
        setPolicyStatus(state, policy, "withdrawn", action, version, deltas);
        updateLedger(state, cityId, releaseResources(city.resourceLedger, requestsFromTerms(policy.terms), "reserved"), action, version, deltas);
      }
      break;
    }
    case "ADVISE_COMPANY_RESPONSE": {
      const before = clone(state.company.internalAdvice);
      state.company.internalAdvice.push({ actionId: action.actionId, actorId: action.actorId, proposal: action.payload });
      addDelta(deltas, action, version, "company.internalAdvice", before, state.company.internalAdvice);
      break;
    }
    case "SUBMIT_COMPANY_RESPONSE": {
      const response = {
        responseId: String(action.payload.responseId),
        issuerId: action.actorId,
        targetPolicyIds: toStrings(action.payload.targetPolicyIds),
        requestedChanges: Array.isArray(action.payload.requestedChanges) ? action.payload.requestedChanges as Array<{ policyId: string; termId: string; requestedValue: number }> : [],
        status: "issued" as const,
      };
      const before = clone(state.company.responses);
      state.company.responses.push(response);
      addDelta(deltas, action, version, "company.responses", before, state.company.responses);
      events.push(eventFor({ ...state, worldVersion: version }, "CompanyResponseIssued", action.actionId, action.actorId, { responseId: response.responseId }));
      if (state.simulation.phase === "post_disclosure" && state.company.projectStage !== "exited") {
        change(state, action, version, deltas, "company.projectStage", state.company.projectStage, "renegotiation" as const, (value) => { state.company.projectStage = value; });
      }
      break;
    }
    case "ADVISE_FINANCING": {
      const stance = String(action.payload.stance ?? "conditional");
      const before = state.metrics.financingConfidence;
      const after = clamp(before + (stance === "withhold" ? -18 : stance === "conditional" ? -6 : 8));
      change(state, action, version, deltas, "metrics.financingConfidence", before, after, (value) => { state.metrics.financingConfidence = value; });
      break;
    }
    case "REQUEST_DUE_DILIGENCE": {
      change(state, action, version, deltas, "round", state.round, Math.max(2, state.round + 1), (value) => { state.round = value; });
      change(state, action, version, deltas, "company.projectStage", state.company.projectStage, "due_diligence" as const, (value) => { state.company.projectStage = value; });
      break;
    }
    case "DISCLOSE_FACT": {
      const fact = state.facts.find((item) => item.factId === String(action.payload.factId));
      if (!fact) throw new Error("fact passed gate but was not found");
      const factIndex = state.facts.indexOf(fact);
      const before = clone(fact);
      fact.visibility = "disclosed";
      fact.audience = toStrings(action.payload.audience);
      fact.disclosedAtVersion = version;
      addDelta(deltas, action, version, `facts.${factIndex}`, before, fact);
      events.push(eventFor({ ...state, worldVersion: version }, "FactDisclosed", action.actionId, action.actorId, { factId: fact.factId, audience: fact.audience }));
      if (fact.kind === "order_quality") {
        const bindingRatio = Number((fact.value as { bindingRatio?: number }).bindingRatio ?? state.company.bindingOrderRatio);
        change(state, action, version, deltas, "company.bindingOrderRatio", state.company.bindingOrderRatio, bindingRatio, (value) => { state.company.bindingOrderRatio = value; });
        change(state, action, version, deltas, "metrics.trust", state.metrics.trust, clamp(state.metrics.trust - 24), (value) => { state.metrics.trust = value; });
        change(state, action, version, deltas, "metrics.financingConfidence", state.metrics.financingConfidence, clamp(state.metrics.financingConfidence - 22), (value) => { state.metrics.financingConfidence = value; });
        change(state, action, version, deltas, "metrics.projectViability", state.metrics.projectViability, clamp(state.metrics.projectViability - 17), (value) => { state.metrics.projectViability = value; });
        change(state, action, version, deltas, "company.projectStage", state.company.projectStage, "renegotiation" as const, (value) => { state.company.projectStage = value; });
      }
      break;
    }
    case "ACCEPT_POLICY": {
      const policy = findPolicy(state, String(action.payload.policyId));
      setPolicyStatus(state, policy, "accepted", action, version, deltas);
      change(state, action, version, deltas, `cities.${policy.cityId}.bidStatus`, state.cities[policy.cityId].bidStatus, "accepted" as const, (value) => { state.cities[policy.cityId].bidStatus = value; });
      const otherCity = policy.cityId === "chengdu" ? "chongqing" : "chengdu";
      if (state.cities[otherCity].bidStatus === "withdrawn") change(state, action, version, deltas, `cities.${otherCity}.bidStatus`, state.cities[otherCity].bidStatus, "closed" as const, (value) => { state.cities[otherCity].bidStatus = value; });
      updateLedger(state, policy.cityId, commitResources(state.cities[policy.cityId].resourceLedger, requestsFromTerms(policy.terms)), action, version, deltas);
      change(state, action, version, deltas, "company.projectStage", state.company.projectStage, "signed" as const, (value) => { state.company.projectStage = value; });
      approveCashCommitments(state, policy.policyId, policy.cityId, policy.terms, action, version, deltas, events);
      const beforeDecision = clone(state.finalDecision);
      state.finalDecision = { decisionId: deterministicId("final-decision", action.actionId), type: "single_city", cityId: policy.cityId, policyId: policy.policyId, actorId: "company_board", decidedAtVersion: version, causeId: action.actionId };
      addDelta(deltas, action, version, "finalDecision", beforeDecision, state.finalDecision);
      break;
    }
    case "REJECT_POLICY": {
      const policy = findPolicy(state, String(action.payload.policyId));
      setPolicyStatus(state, policy, "rejected", action, version, deltas);
      updateLedger(state, policy.cityId, releaseResources(state.cities[policy.cityId].resourceLedger, requestsFromTerms(policy.terms), "reserved"), action, version, deltas);
      break;
    }
    case "WITHDRAW_COMMITMENT": {
      const commitment = state.commitments.find((item) => item.commitmentId === String(action.payload.commitmentId));
      if (!commitment) throw new Error("unknown commitment");
      const before = commitment.status;
      commitment.status = "withdrawn";
      commitment.lastCauseId = action.actionId;
      addDelta(deltas, action, version, `commitments.${state.commitments.indexOf(commitment)}.status`, before, commitment.status);
      const cityId = commitment.payer.startsWith("chengdu") ? "chengdu" : "chongqing";
      updateLedger(state, cityId, releaseResources(state.cities[cityId].resourceLedger, { fiscalMillionCny: commitment.amountMillionCny }, "committed"), action, version, deltas);
      events.push(eventFor({ ...state, worldVersion: version }, "CommitmentStatusChanged", action.actionId, action.actorId, { commitmentId: commitment.commitmentId, status: commitment.status }));
      break;
    }
    case "EXIT_PROJECT": {
      change(state, action, version, deltas, "company.projectStage", state.company.projectStage, "exited" as const, (value) => { state.company.projectStage = value; });
      change(state, action, version, deltas, "metrics.projectViability", state.metrics.projectViability, 0, (value) => { state.metrics.projectViability = value; });
      for (const commitment of state.commitments.filter((item) => item.status === "approved")) {
        const before = commitment.status;
        commitment.status = "withdrawn";
        commitment.lastCauseId = action.actionId;
        addDelta(deltas, action, version, `commitments.${state.commitments.indexOf(commitment)}.status`, before, commitment.status);
        const cityId = commitment.payer.startsWith("chengdu") ? "chengdu" : "chongqing";
        updateLedger(state, cityId, releaseResources(state.cities[cityId].resourceLedger, { fiscalMillionCny: commitment.amountMillionCny }, "committed"), action, version, deltas);
        events.push(eventFor({ ...state, worldVersion: version }, "CommitmentStatusChanged", action.actionId, action.actorId, { commitmentId: commitment.commitmentId, status: commitment.status }));
      }
      for (const city of Object.values(state.cities)) {
        for (const policy of city.policies.filter((item) => item.status === "accepted")) {
          const nonFiscal = requestsFromTerms(policy.terms);
          delete nonFiscal.fiscalMillionCny;
          if (Object.keys(nonFiscal).length > 0) updateLedger(state, city.cityId, releaseResources(city.resourceLedger, nonFiscal, "committed"), action, version, deltas);
        }
      }
      const beforeDecision = clone(state.finalDecision);
      state.finalDecision = { decisionId: deterministicId("final-decision", action.actionId), type: "regional_exit", actorId: "company_board", decidedAtVersion: version, causeId: action.actionId };
      addDelta(deltas, action, version, "finalDecision", beforeDecision, state.finalDecision);
      break;
    }
    case "ADVANCE_PROJECT": {
      applyProjectProgress(state, action, version, deltas, events);
      break;
    }
    case "PUBLISH_STAKEHOLDER_REACTION": {
      const metrics = action.payload.metrics as Record<string, number>;
      for (const [metric, delta] of Object.entries(metrics)) {
        const key = metric as keyof WorldState["stakeholders"];
        const before = state.stakeholders[key];
        const after = clamp(before + delta);
        change(state, action, version, deltas, `stakeholders.${key}`, before, after, (value) => { state.stakeholders[key] = value; });
      }
      break;
    }
    case "SEND_DEBATE_MESSAGE": {
      const threadId = String(action.payload.threadId);
      let thread = state.debateThreads.find((item) => item.threadId === threadId);
      const before = clone(state.debateThreads);
      if (!thread) {
        thread = {
          threadId,
          topic: "成渝项目功能分工与重复补贴协调",
          participantIds: ["regional_coordinator", "chengdu_leader", "chongqing_leader", "policy_supervisor"],
          status: "open",
          messages: [],
        };
        state.debateThreads.push(thread);
      }
      thread.messages.push({
        messageId: String(action.payload.messageId),
        threadId,
        actorId: action.actorId,
        sequence: thread.messages.length + 1,
        turnType: action.payload.turnType as "challenge" | "position" | "proposal" | "counter" | "concession",
        issue: action.payload.issue as "functional_allocation" | "duplicate_subsidy" | "fiscal_risk",
        stance: action.payload.stance as "support" | "oppose" | "conditional" | "mediate",
        content: String(action.payload.content),
        audience: toStrings(action.payload.audience),
        visibility: action.payload.visibility === "public" ? "public" : "participants",
        ...(typeof action.payload.replyToMessageId === "string" ? { replyToMessageId: action.payload.replyToMessageId } : {}),
        createdAtVersion: version,
      });
      addDelta(deltas, action, version, "debateThreads", before, state.debateThreads);
      events.push(eventFor({ ...state, worldVersion: version }, "DebateMessagePublished", action.actionId, action.actorId, { threadId, messageId: action.payload.messageId, sequence: thread.messages.length, turnType: action.payload.turnType }));
      break;
    }
    case "ISSUE_COORDINATION_OPINION": {
      const before = clone(state.coordinationOpinions);
      const opinion: CoordinationOpinion = {
        opinionId: String(action.payload.opinionId), actorId: "regional_coordinator",
        policyIds: toStrings(action.payload.policyIds),
        recommendation: action.payload.recommendation === "split_functions" || action.payload.recommendation === "reduce_duplicate_subsidy" ? action.payload.recommendation : "no_coordination_needed",
        reasonCodes: toStrings(action.payload.reasonCodes),
        ...(typeof action.payload.threadId === "string" ? { threadId: action.payload.threadId } : {}),
        ...(typeof action.payload.summary === "string" ? { summary: action.payload.summary } : {}),
        ...(Array.isArray(action.payload.concessions) ? { concessions: toStrings(action.payload.concessions) } : {}),
      };
      state.coordinationOpinions.push(opinion);
      addDelta(deltas, action, version, "coordinationOpinions", before, state.coordinationOpinions);
      if (opinion.threadId) {
        const thread = state.debateThreads.find((item) => item.threadId === opinion.threadId);
        if (thread) {
          const threadBefore = clone(thread);
          thread.status = "resolved";
          thread.resolutionOpinionId = opinion.opinionId;
          addDelta(deltas, action, version, `debateThreads.${state.debateThreads.indexOf(thread)}`, threadBefore, thread);
        }
      }
      break;
    }
    case "PROPOSE_COORDINATION_PLAN": {
      const before = clone(state.coordinationPlans);
      const payload = action.payload as unknown as Omit<CoordinationPlan, "actorId" | "responses" | "auditStatus" | "auditReasonCodes" | "status" | "createdAtVersion">;
      state.coordinationPlans.push({
        ...clone(payload), actorId: "regional_coordinator", responses: {}, auditStatus: "pending", auditReasonCodes: [], status: "proposed", createdAtVersion: version,
      });
      addDelta(deltas, action, version, "coordinationPlans", before, state.coordinationPlans);
      break;
    }
    case "RESPOND_COORDINATION_PLAN": {
      const plan = findCoordinationPlan(state, String(action.payload.planId));
      const cityId = action.payload.cityId === "chengdu" ? "chengdu" : "chongqing";
      const before = clone(plan.responses);
      plan.responses[cityId] = {
        cityId, actorId: `${cityId}_leader`, decision: action.payload.decision === "reject" ? "reject" : action.payload.decision === "conditional" ? "conditional" : "accept",
        conditions: toStrings(action.payload.conditions), respondedAtVersion: version,
      };
      if (plan.responses[cityId]?.decision === "reject") plan.status = "rejected";
      addDelta(deltas, action, version, `coordinationPlans.${state.coordinationPlans.indexOf(plan)}.responses`, before, plan.responses);
      break;
    }
    case "AUDIT_COORDINATION_PLAN": {
      const plan = findCoordinationPlan(state, String(action.payload.planId));
      const before = { auditStatus: plan.auditStatus, auditReasonCodes: clone(plan.auditReasonCodes) };
      plan.auditStatus = action.payload.decision === "approve" ? "approved" : "repair_required";
      plan.auditReasonCodes = toStrings(action.payload.reasonCodes);
      addDelta(deltas, action, version, `coordinationPlans.${state.coordinationPlans.indexOf(plan)}.audit`, before, { auditStatus: plan.auditStatus, auditReasonCodes: plan.auditReasonCodes });
      break;
    }
    case "ACCEPT_COORDINATION_PLAN": {
      const plan = findCoordinationPlan(state, String(action.payload.planId));
      const beforePlanStatus = plan.status;
      plan.status = "accepted";
      addDelta(deltas, action, version, `coordinationPlans.${state.coordinationPlans.indexOf(plan)}.status`, beforePlanStatus, plan.status);
      for (const cityId of ["chengdu", "chongqing"] as const) {
        const city = state.cities[cityId];
        for (const policy of city.policies.filter((item) => item.status === "issued")) {
          setPolicyStatus(state, policy, "withdrawn", action, version, deltas);
          updateLedger(state, cityId, releaseResources(city.resourceLedger, requestsFromTerms(policy.terms), "reserved"), action, version, deltas);
        }
        change(state, action, version, deltas, `cities.${cityId}.bidStatus`, city.bidStatus, "accepted" as const, (value) => { city.bidStatus = value; });
        const calculations = calculatePolicyResources(city.resourceLedger, plan.cityTerms[cityId]);
        updateLedger(state, cityId, reserveResources(city.resourceLedger, calculations), action, version, deltas);
        updateLedger(state, cityId, commitResources(city.resourceLedger, requestsFromTerms(plan.cityTerms[cityId])), action, version, deltas);
        approveCashCommitments(state, plan.planId, cityId, plan.cityTerms[cityId], action, version, deltas, events);
      }
      change(state, action, version, deltas, "company.projectStage", state.company.projectStage, "signed" as const, (value) => { state.company.projectStage = value; });
      const beforeDecision = clone(state.finalDecision);
      state.finalDecision = { decisionId: deterministicId("final-decision", action.actionId), type: "coordination", coordinationPlanId: plan.planId, actorId: "company_board", decidedAtVersion: version, causeId: action.actionId };
      addDelta(deltas, action, version, "finalDecision", beforeDecision, state.finalDecision);
      break;
    }
    case "AUDIT_POLICY_PACK": {
      const audits = Array.isArray(action.payload.audits) ? action.payload.audits as Array<{ policyId: string; decision: "approve" | "flag" | "require_repair"; reasonCodes: string[] }> : [];
      for (const audit of audits) {
        const policy = findPolicy(state, audit.policyId);
        const before = policy.auditStatus;
        policy.auditStatus = audit.decision === "approve" ? "approved" : audit.decision === "flag" ? "flagged" : "repair_required";
        addDelta(deltas, action, version, `cities.${policy.cityId}.policies.${state.cities[policy.cityId].policies.indexOf(policy)}.auditStatus`, before, policy.auditStatus);
      }
      break;
    }
    case "ASSESS_LONG_TERM_IMPACT": {
      const before = clone(state.impactAssessments);
      const assessments = Array.isArray(action.payload.assessments) ? action.payload.assessments as ImpactAssessment[] : [];
      state.impactAssessments.push(...assessments.map((item) => ({ ...item, assessedAtVersion: version })));
      addDelta(deltas, action, version, "impactAssessments", before, state.impactAssessments);
      if (state.company.projectStage !== "exited") change(state, action, version, deltas, "company.projectStage", state.company.projectStage, "completed" as const, (value) => { state.company.projectStage = value; });
      break;
    }
    case "PASS":
      break;
  }
}

function applyProjectProgress(state: WorldState, action: AgentAction, version: number, deltas: StateDelta[], events: WorldEvent[]): void {
  const metrics = ["verifiedJobs", "verifiedInvestmentMillionCny", "annualOutputMillionCny"] as const;
  for (const metric of metrics) {
    const next = action.payload[metric];
    if (typeof next === "number" && next >= state.company[metric]) {
      const before = state.company[metric];
      change(state, action, version, deltas, `company.${metric}`, before, next, (value) => { state.company[metric] = value; });
    }
  }
  for (const commitment of state.commitments) {
    if (commitment.status !== "approved" || !commitment.trigger) continue;
    const actual = state.company[commitment.trigger.metric];
    if (actual < commitment.trigger.value) continue;
    const beforeStatus = commitment.status;
    commitment.status = "paid";
    commitment.lastCauseId = action.actionId;
    addDelta(deltas, action, version, `commitments.${state.commitments.indexOf(commitment)}.status`, beforeStatus, commitment.status);
    const cityId = commitment.payer.startsWith("chengdu") ? "chengdu" : "chongqing";
    updateLedger(state, cityId, payFiscalResource(state.cities[cityId].resourceLedger, commitment.amountMillionCny), action, version, deltas);
    events.push(eventFor({ ...state, worldVersion: version }, "CommitmentStatusChanged", action.actionId, action.actorId, { commitmentId: commitment.commitmentId, status: commitment.status }));
  }
  const failedIds = new Set(toStrings(action.payload.failedCommitmentIds));
  for (const commitment of state.commitments) {
    if (!failedIds.has(commitment.commitmentId) || commitment.status !== "approved") continue;
    const beforeStatus = commitment.status;
    commitment.status = "failed";
    commitment.lastCauseId = action.actionId;
    addDelta(deltas, action, version, `commitments.${state.commitments.indexOf(commitment)}.status`, beforeStatus, commitment.status);
    const cityId = commitment.payer.startsWith("chengdu") ? "chengdu" : "chongqing";
    const city = state.cities[cityId];
    change(state, action, version, deltas, `cities.${cityId}.policyCredibility`, city.policyCredibility, clamp(city.policyCredibility - 12), (value) => { city.policyCredibility = value; });
    change(state, action, version, deltas, "metrics.trust", state.metrics.trust, clamp(state.metrics.trust - 10), (value) => { state.metrics.trust = value; });
    change(state, action, version, deltas, "company.projectStage", state.company.projectStage, "renegotiation" as const, (value) => { state.company.projectStage = value; });
    events.push(eventFor({ ...state, worldVersion: version }, "CommitmentStatusChanged", action.actionId, action.actorId, { commitmentId: commitment.commitmentId, status: commitment.status, consequence: "credibility_down_and_renegotiation" }));
  }
  if (state.commitments.some((item) => item.status === "paid")) {
    change(state, action, version, deltas, "company.projectStage", state.company.projectStage, "delivery" as const, (value) => { state.company.projectStage = value; });
    change(state, action, version, deltas, "metrics.trust", state.metrics.trust, clamp(state.metrics.trust + 8), (value) => { state.metrics.trust = value; });
    change(state, action, version, deltas, "metrics.projectViability", state.metrics.projectViability, clamp(state.metrics.projectViability + 10), (value) => { state.metrics.projectViability = value; });
  }
}

function updateLedger(state: WorldState, cityId: "chengdu" | "chongqing", next: ResourceLedger, action: AgentAction, version: number, deltas: StateDelta[]): void {
  const city = state.cities[cityId];
  const before = clone(city.resourceLedger);
  city.resourceLedger = next;
  addDelta(deltas, action, version, `cities.${cityId}.resourceLedger`, before, next);
  const fiscal = next.fiscalMillionCny;
  city.fiscal.availableMillionCny = fiscal.available;
  city.fiscal.committedMillionCny = fiscal.committed;
  city.fiscal.paidMillionCny = fiscal.paid;
}

function setPolicyStatus(state: WorldState, policy: PolicyPack, status: PolicyPack["status"], action: AgentAction, version: number, deltas: StateDelta[]): void {
  const before = policy.status;
  policy.status = status;
  addDelta(deltas, action, version, `cities.${policy.cityId}.policies.${state.cities[policy.cityId].policies.indexOf(policy)}.status`, before, status);
}

function approveCashCommitments(
  state: WorldState,
  sourcePolicyId: string,
  cityId: "chengdu" | "chongqing",
  terms: PolicyPack["terms"],
  action: AgentAction,
  version: number,
  deltas: StateDelta[],
  events: WorldEvent[],
): void {
  for (const term of terms.filter((item) => item.type === "cash_support" && (item.amountMillionCny ?? 0) > 0)) {
    const commitment: Commitment = {
      commitmentId: deterministicId("commitment", sourcePolicyId, cityId, term.termId), sourcePolicyId,
      payer: `${cityId}_government`, beneficiary: "xinglan_robotics", amountMillionCny: term.amountMillionCny ?? 0,
      ...(term.trigger ? { trigger: term.trigger } : {}), ...(term.deadline ? { deadline: term.deadline } : {}),
      failureAction: term.failureAction ?? "cancel_payment", status: "approved", createdAtVersion: version, lastCauseId: action.actionId,
    };
    const before = clone(state.commitments);
    state.commitments.push(commitment);
    addDelta(deltas, action, version, "commitments", before, state.commitments);
    events.push(eventFor({ ...state, worldVersion: version }, "CommitmentApproved", action.actionId, action.actorId, { commitmentId: commitment.commitmentId }));
  }
}

function termDiff(before: PolicyPack["terms"], after: PolicyPack["terms"]): Array<{ termId: string; before: PolicyPack["terms"][number] | null; after: PolicyPack["terms"][number] | null }> {
  const ids = new Set([...before.map((term) => term.termId), ...after.map((term) => term.termId)]);
  return [...ids].flatMap((termId) => {
    const previous = before.find((term) => term.termId === termId) ?? null;
    const next = after.find((term) => term.termId === termId) ?? null;
    return digest(previous) === digest(next) ? [] : [{ termId, before: clone(previous), after: clone(next) }];
  });
}

function findCoordinationPlan(state: WorldState, planId: string): CoordinationPlan {
  const plan = state.coordinationPlans.find((item) => item.planId === planId);
  if (!plan) throw new Error(`unknown coordination plan: ${planId}`);
  return plan;
}

function findPolicy(state: WorldState, policyId: string): PolicyPack {
  const policy = Object.values(state.cities).flatMap((city) => city.policies).find((item) => item.policyId === policyId);
  if (!policy) throw new Error(`unknown policy: ${policyId}`);
  return policy;
}

function addDelta(deltas: StateDelta[], action: AgentAction, version: number, path: string, before: unknown, after: unknown): void {
  if (digest(before) === digest(after)) return;
  deltas.push({ deltaId: deterministicId("delta", action.actionId, path, version), causeId: action.actionId, path, before: before === undefined ? null : clone(before), after: after === undefined ? null : clone(after), actorId: action.actorId, worldVersion: version });
}

function change<T>(state: WorldState, action: AgentAction, version: number, deltas: StateDelta[], path: string, before: T, after: T, setter: (value: T) => void): void {
  void state;
  setter(after);
  addDelta(deltas, action, version, path, before, after);
}

function eventFor(state: WorldState, eventType: WorldEvent["eventType"], causeId: string, actorId: string, payload: Record<string, unknown>): WorldEvent {
  return {
    eventId: deterministicId("event", state.runId, eventType, causeId, state.worldVersion),
    eventType,
    causeId,
    actorId,
    worldVersion: state.worldVersion,
    occurredAt: new Date(Date.UTC(2026, 7, 11, 0, 0, state.worldVersion)).toISOString(),
    payload,
  };
}

function buildEvidence(state: WorldState, action: AgentAction): DecisionReceipt["evidence"] {
  const evidence: DecisionReceipt["evidence"] = action.evidenceFactIds.flatMap((factId) => {
    const fact = state.facts.find((item) => item.factId === factId);
    return fact ? [{ kind: "fact" as const, id: factId, digest: digest(fact) }] : [];
  });
  evidence.push({ kind: "state", id: `${state.runId}@${state.worldVersion}`, digest: digest({ metrics: state.metrics, company: state.company, cities: state.cities }) });
  return evidence;
}

function remember(state: WorldState, action: AgentAction, deltas: StateDelta[]): void {
  const summary = `${action.kind}: ${action.reasoning}; changed ${deltas.map((delta) => delta.path).join(", ") || "no world field"}`;
  const memory = state.agentMemory[action.actorId] ??= [];
  memory.push({ causeId: action.actionId, summary });
}

function inferString(value: unknown, key: string, fallback: string): string {
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "string") return (value as Record<string, string>)[key] ?? fallback;
  return fallback;
}

function toStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
