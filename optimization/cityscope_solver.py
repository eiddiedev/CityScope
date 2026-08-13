#!/usr/bin/env python3
"""CityScope CP-SAT candidate generator. JSON enters on stdin and JSON exits on stdout."""

import json
import sys
import time
from ortools.sat.python import cp_model
import ortools


CITIES = ("chengdu", "chongqing")
RESOURCES = ("fiscalMillionCny", "landHectares", "factorySqm", "energyMw", "talentHousingUnits")


def solve_profile(data, profile, banned):
    model = cp_model.CpModel()
    functions = data["functions"]
    by_id = {item["functionId"]: item for item in functions}
    y = {item["functionId"]: model.new_bool_var(f"selected_{item['functionId']}") for item in functions}
    x = {(item["functionId"], city): model.new_bool_var(f"assign_{item['functionId']}_{city}") for item in functions for city in CITIES}

    for item in functions:
        function_id = item["functionId"]
        model.add(sum(x[(function_id, city)] for city in CITIES) == y[function_id])
    scenario = profile.get("scenarioConstraints", {})
    no_landing = bool(scenario.get("noLanding"))
    model.add(sum(y.values()) == 0 if no_landing else sum(y.values()) >= 2)
    if not no_landing:
        model.add(y["rd_center"] + y["smart_factory"] >= 1)
    model.add(y["headquarters"] <= y["rd_center"])
    model.add(y["supply_chain_base"] <= y["smart_factory"])
    for city in CITIES:
        model.add(x[("headquarters", city)] <= x[("rd_center", city)])
        model.add(x[("supply_chain_base", city)] <= x[("smart_factory", city)])

    for city in CITIES:
        capacities = data["cities"][city]["capacities"]
        for resource in RESOURCES:
            model.add(sum(x[(item["functionId"], city)] * int(item["demands"][resource]) for item in functions) <= int(capacities[resource]))
    model.add(sum(y[item["functionId"]] * int(item["demands"]["investmentMillionCny"]) for item in functions) <= int(data["investmentPlanMillionCny"]))

    city_used = {city: model.new_bool_var(f"city_used_{city}") for city in CITIES}
    for city in CITIES:
        assigned = [x[(item["functionId"], city)] for item in functions]
        for variable in assigned:
            model.add(variable <= city_used[city])
        model.add(sum(assigned) >= city_used[city])
    dual_city = model.new_bool_var("dual_city")
    model.add(dual_city <= city_used["chengdu"])
    model.add(dual_city <= city_used["chongqing"])
    model.add(dual_city >= city_used["chengdu"] + city_used["chongqing"] - 1)

    if "maxInvestmentMillionCny" in scenario:
        model.add(sum(y[item["functionId"]] * int(item["demands"]["investmentMillionCny"]) for item in functions) <= int(scenario["maxInvestmentMillionCny"]))
    if "maxFunctions" in scenario:
        model.add(sum(y.values()) <= int(scenario["maxFunctions"]))
    if "maxCities" in scenario:
        model.add(sum(city_used.values()) <= int(scenario["maxCities"]))
    if scenario.get("requireDualCity"):
        model.add(dual_city == 1)
    if scenario.get("requireSingleCity"):
        selected_city = scenario["requireSingleCity"]
        other_city = "chongqing" if selected_city == "chengdu" else "chengdu"
        model.add(city_used[selected_city] == 1)
        model.add(city_used[other_city] == 0)
    for function_id, city in scenario.get("requiredAssignments", {}).items():
        model.add(x[(function_id, city)] == 1)

    for signature in banned:
        matches = []
        for item in functions:
            function_id = item["functionId"]
            assignment = signature[function_id]
            matches.append(y[function_id].Not() if assignment == "none" else x[(function_id, assignment)])
        model.add(sum(matches) <= len(matches) - 1)

    weights = profile["objectiveWeights"]
    signals = data["signals"]
    fiscal_capacity = sum(data["cities"][city]["capacities"]["fiscalMillionCny"] for city in CITIES)
    objective_terms = []
    for item in functions:
        function_id = item["functionId"]
        selected_coefficient = 0
        selected_coefficient += weights["innovationValue"] * item["innovationValue"] * signals["talentAttraction"] * 1000 // (215 * 70)
        selected_coefficient += weights["manufacturingValue"] * item["manufacturingValue"] * signals["supplyChainReadiness"] * 1000 // (205 * 65)
        selected_coefficient += weights["employment"] * item["jobs"] * 1000 // 2170
        selected_coefficient += weights["publicBenefit"] * item["publicBenefit"] * (signals["publicTrust"] + signals["residentSupport"]) * 1000 // (270 * 140)
        selected_coefficient += weights["enterpriseValue"] * item["enterpriseValue"] * signals["projectViability"] * 1000 // (290 * 76)
        selected_coefficient += weights["fiscalCost"] * item["demands"]["fiscalMillionCny"] * 1000 // fiscal_capacity
        selected_coefficient += weights["liquidityRisk"] * item["demands"]["investmentMillionCny"] * data["riskFactorPercent"] * 10 // data["investmentPlanMillionCny"]
        objective_terms.append(y[function_id] * int(selected_coefficient))
        for city in CITIES:
            execution_coefficient = weights["executionProbability"] * item["cityExecution"][city] * 10
            capacities = data["cities"][city]["capacities"]
            pressure_basis_points = sum(item["demands"][resource] * 1000 // max(1, capacities[resource]) for resource in RESOURCES)
            pressure_coefficient = weights["resourcePressure"] * pressure_basis_points
            objective_terms.append(x[(function_id, city)] * int(execution_coefficient + pressure_coefficient))
    objective_terms.append(dual_city * int(weights["regionalSynergy"] * 650))
    model.maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(data.get("timeLimitSeconds", 2))
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = int(data.get("seed", 1)) % 2147483647
    status = solver.solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None, solver.status_name(status), solver.wall_time
    assignments = {}
    for item in functions:
        function_id = item["functionId"]
        assignments[function_id] = "none"
        for city in CITIES:
            if solver.value(x[(function_id, city)]) == 1:
                assignments[function_id] = city
                break
    return {
        "profileId": profile["profileId"],
        "assignments": assignments,
        "objectiveValue": solver.objective_value,
        "solverStatus": "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
    }, solver.status_name(status), solver.wall_time


def solve_payload(data):
    started = time.perf_counter()
    candidates = []
    banned = []
    statuses = []
    wall_times = []
    for profile in data["profiles"]:
        candidate, status, wall_time = solve_profile(data, profile, banned)
        statuses.append(status)
        wall_times.append(wall_time)
        if candidate is None:
            continue
        candidates.append(candidate)
        banned.append(candidate["assignments"])
        if len(candidates) >= int(data.get("maxCandidates", 5)):
            break
    overall = "INFEASIBLE" if not candidates else "OPTIMAL" if all(item["solverStatus"] == "OPTIMAL" for item in candidates) else "FEASIBLE"
    return {
        "engineVersion": f"ortools-{ortools.__version__}+cityscope-option-set.v2",
        "status": overall,
        "solveTimeMs": round((time.perf_counter() - started) * 1000, 2),
        "solverWallTimeMs": round(sum(wall_times) * 1000, 2),
        "statuses": statuses,
        "candidates": candidates,
    }


def main():
    if "--serve" in sys.argv:
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                print(json.dumps(solve_payload(json.loads(line)), ensure_ascii=False), flush=True)
            except Exception as error:
                print(json.dumps({"status": "ERROR", "error": f"{type(error).__name__}: {error}"}), flush=True)
        return
    print(json.dumps(solve_payload(json.load(sys.stdin)), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"status": "ERROR", "error": f"{type(error).__name__}: {error}"}), file=sys.stdout)
        sys.exit(1)
