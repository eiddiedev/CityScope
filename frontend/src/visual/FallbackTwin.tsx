import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";

export interface OrganizationLayerMember {
  actorId: string;
  displayName: string;
  role: string;
  actorKind: string;
}

export interface OrganizationLayerGroup {
  name: string;
  tone: "mint" | "ember" | "blue" | "gold" | "service";
  /** 卡片左上角的城市坐标，与 LANDMARKS 同一坐标系 */
  anchor: [number, number];
  members: OrganizationLayerMember[];
}

interface FallbackTwinProps {
  activeActorId?: string;
  /** 组织剖面图层：提供后在城市图上按地理锚点渲染分组卡片 */
  organizationLayer?: { groups: OrganizationLayerGroup[] };
  /** 点击地图空白处（未拖拽）时触发，用于关闭 Agent X-Ray */
  onDeselectActor?: () => void;
  /** 当前视口下各部门建筑的屏幕锚点，供对话框随地图拖动和缩放 */
  onAnchorPositions?: (positions: Record<string, { left: number; top: number }>) => void;
  onSelectVisualKey: (key: string) => void;
  onSelectActor: (actorId: string) => void;
}

type LandmarkKind = "leader" | "investment" | "finance" | "company" | "service";

interface LandmarkSpec {
  actorId: string;
  city: "成都" | "重庆" | "区域" | "企业" | "规则服务";
  label: string;
  x: number;
  y: number;
  color: string;
  kind: LandmarkKind;
}

/** 等距投影：城市坐标 (x, y) → 屏幕坐标 */
const U = 86;
const V = 43;
const MOUNTAIN_AXIS_X = 10.15;
const iso = (x: number, y: number): [number, number] => [(x - y) * U, (x + y) * V];
const isoPoint = (x: number, y: number, lift = 0) => {
  const [sx, sy] = iso(x, y);
  return `${sx},${sy - lift}`;
};

/** 颜色工具：关键建筑整体上色，环境建筑保持白色 */
function mix(hex: string, target: [number, number, number], amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const channel = (value: number, goal: number) => Math.round(value + (goal - value) * amount);
  return `rgb(${channel(r, target[0])},${channel(g, target[1])},${channel(b, target[2])})`;
}
const tint = (hex: string, amount: number) => mix(hex, [255, 255, 255], amount);
const darken = (hex: string, amount: number) => mix(hex, [52, 60, 57], amount);

/** 地标位置均已避开道路；产业组位于山脉上端延伸方向，统筹组位于下端延伸方向 */
const LANDMARKS: LandmarkSpec[] = [
  { actorId: "chengdu_investment", city: "成都", label: "招商促进局", x: 1.5, y: 0.55, color: "#d9a83c", kind: "investment" },
  { actorId: "chengdu_finance", city: "成都", label: "财政审查局", x: 5.2, y: 4.2, color: "#6e9be8", kind: "finance" },
  { actorId: "chengdu_leader", city: "成都", label: "城市决策中心", x: 1.5, y: 8.5, color: "#4fbf98", kind: "leader" },
  { actorId: "chongqing_leader", city: "重庆", label: "城市决策中心", x: 17.2, y: 0.5, color: "#ef785d", kind: "leader" },
  { actorId: "chongqing_finance", city: "重庆", label: "财政审查局", x: 13.4, y: 4.0, color: "#9b83d5", kind: "finance" },
  { actorId: "chongqing_investment", city: "重庆", label: "招商促进局", x: 16.7, y: 9.6, color: "#55b7dc", kind: "investment" },
  { actorId: "regional_coordinator", city: "区域", label: "成渝协调中心", x: 8.4, y: 16.4, color: "#9a7fd0", kind: "leader" },
  { actorId: "policy_supervisor", city: "区域", label: "政策审计中心", x: 11.9, y: 16.4, color: "#638bd5", kind: "finance" },
  { actorId: "company_ceo", city: "企业", label: "CEO 战略室", x: 8.05, y: -4.5, color: "#d9a83c", kind: "company" },
  { actorId: "company_cfo", city: "企业", label: "CFO 财务室", x: 12.25, y: -4.5, color: "#ef785d", kind: "company" },
  { actorId: "company_board", city: "企业", label: "企业董事会", x: MOUNTAIN_AXIS_X, y: -4.4, color: "#4fbf98", kind: "company" },
  { actorId: "due_diligence_service", city: "规则服务", label: "尽调数据站", x: 8.4, y: 17.9, color: "#8a99ad", kind: "service" },
  { actorId: "world_resource_service", city: "规则服务", label: "资源计算站", x: 11.9, y: 17.9, color: "#8a99ad", kind: "service" },
];

const STAKEHOLDERS = [
  { actorId: "investor", label: "投资机构", x: 13.65, y: -4.4, color: "#d9a83c", kind: "office" as const },
  { actorId: "talent_sme", label: "人才与中小企业", x: 16.4, y: 4.2, color: "#50b58e", kind: "block" as const },
  { actorId: "resident", label: "居民代表", x: 1.4, y: 4.2, color: "#e87973", kind: "house" as const },
];

const PROJECT_CORE = { x: MOUNTAIN_AXIS_X, y: -4.4 };

/** 高层重点节点需要更大的白模净空，避免等距投影下前后建筑发生视觉穿插 */
const AMBIENT_CLEARANCE_BY_ACTOR: Partial<Record<string, number>> = {
  policy_supervisor: 1.7,
  talent_sme: 1.5,
  chengdu_leader: 1.65,
  chongqing_leader: 1.65,
};

/** 组织剖面图层：actorId → 地标位置与颜色 */
const ORG_MEMBER_STYLE = new Map([...LANDMARKS, ...STAKEHOLDERS].map((item) => [item.actorId, item] as const));

type OrganizationRelationship = {
  from: string;
  to: string;
  label: string;
  tone: "advice" | "authority" | "coordination" | "company" | "service" | "stakeholder";
  curve?: number;
  bidirectional?: boolean;
};

/** 组织剖面的正式权责与信息流；箭头永远指向接收方 */
const ORGANIZATION_RELATIONSHIPS: OrganizationRelationship[] = [
  { from: "chengdu_investment", to: "chengdu_leader", label: "招商建议", tone: "advice", curve: -34 },
  { from: "chengdu_finance", to: "chengdu_leader", label: "财政建议 / 异议", tone: "advice", curve: 38 },
  { from: "chongqing_investment", to: "chongqing_leader", label: "招商建议", tone: "advice", curve: 34 },
  { from: "chongqing_finance", to: "chongqing_leader", label: "财政建议 / 异议", tone: "advice", curve: -38 },
  { from: "company_ceo", to: "company_board", label: "战略意见", tone: "company", curve: -28 },
  { from: "company_cfo", to: "company_board", label: "财务意见", tone: "company", curve: 28 },
  { from: "chengdu_leader", to: "policy_supervisor", label: "政策送审", tone: "authority", curve: -72 },
  { from: "chongqing_leader", to: "policy_supervisor", label: "政策送审", tone: "authority", curve: 72 },
  { from: "policy_supervisor", to: "regional_coordinator", label: "审计结论", tone: "authority", curve: 24 },
  { from: "regional_coordinator", to: "chengdu_leader", label: "区域协调", tone: "coordination", curve: 94 },
  { from: "regional_coordinator", to: "chongqing_leader", label: "区域协调", tone: "coordination", curve: -94 },
  { from: "company_board", to: "investor", label: "融资判断 / 企业反馈", tone: "company", curve: -48, bidirectional: true },
  { from: "due_diligence_service", to: "company_board", label: "尽调事实", tone: "service", curve: 104 },
  { from: "world_resource_service", to: "chengdu_leader", label: "资源与履约校验", tone: "service", curve: 118 },
  { from: "world_resource_service", to: "chongqing_leader", label: "资源与履约校验", tone: "service", curve: -118 },
  { from: "talent_sme", to: "regional_coordinator", label: "人才 / 供应链反馈", tone: "stakeholder", curve: -70 },
  { from: "resident", to: "regional_coordinator", label: "居民反馈", tone: "stakeholder", curve: 70 },
];

const ORG_RELATION_COLORS: Record<OrganizationRelationship["tone"], string> = {
  advice: "#4e78a8",
  authority: "#7560aa",
  coordination: "#2f8668",
  company: "#a87927",
  service: "#607d8b",
  stakeholder: "#3d9175",
};

/** 路网：直行车道 + 直角转弯，不做蜿蜒曲线 */
const ROADS: Array<{ name: string; points: Array<[number, number]>; width?: number; labelOffset?: string }> = [
  { name: "天 府 大 道", points: [[-1.5, 1.5], [4.8, 1.5], [7.9, 1.8]], labelOffset: "38%" },
  { name: "科 创 路", points: [[-1.5, 6.0], [5.2, 6.0], [7.8, 6.3]], labelOffset: "34%" },
  { name: "锦 江 路", points: [[2.6, -0.3], [2.6, 7.2], [2.4, 13.8]], labelOffset: "61%" },
  { name: "高 新 大 道", points: [[6.5, -0.3], [6.5, 7.2], [6.3, 13.8]], labelOffset: "43%" },
  { name: "两 江 大 道", points: [[13.0, 1.9], [17.4, 1.9], [21.5, 2.2]], labelOffset: "39%" },
  { name: "智 造 路", points: [[13.0, 6.2], [17.8, 6.2], [21.5, 6.0]], labelOffset: "61%" },
  { name: "渝 州 大 道", points: [[14.7, -0.3], [14.7, 7.2], [14.5, 13.8]], labelOffset: "38%" },
  { name: "嘉 陵 路", points: [[18.3, -0.3], [18.3, 7.2], [18.1, 13.8]], labelOffset: "64%" },
  { name: "履 约 核 验 街", points: [[-1.5, 11.0], [4.4, 11.0], [7.8, 11.3]], labelOffset: "42%" },
  { name: "渝 南 大 道", points: [[13.2, 10.9], [17.6, 10.9], [21.5, 11.3]], labelOffset: "58%" },
  { name: "双 城 协 调 路", points: [[6.3, 13.8], [6.3, 18.9], [14.5, 18.9], [14.5, 13.8]], labelOffset: "50%" },
];

const RIVER_POINTS: Array<[number, number]> = [[-2, -1.1], [2, -1.7], [6, -1], [10, -1.8], [14, -1.1], [18, -1.7], [22, -1]];

/** 龙泉山脉保持真实范围；两端只借用山脉走向组织功能区，不再绘制延伸山峰 */
const MOUNTAIN_SEGMENTS: Array<{ yStart: number; yEnd: number; xBase?: number }> = [
  { yStart: -0.8, yEnd: 13.8 },
];

const PARKS = [
  { x: 4.6, y: 8.9, w: 2.2, d: 1.3, name: "高新中央公园" },
  { x: 16.2, y: 8.4, w: 1.6, d: 1.1, name: "滨江公园" },
  { x: 1.2, y: 12.4, w: 1.7, d: 1.1, name: "锦官城公园" },
];

function smoothPath(points: Array<[number, number]>): string {
  const pts = points.map(([x, y]) => iso(x, y));
  if (pts.length < 3) return `M ${pts[0][0]} ${pts[0][1]}${pts[1] ? ` L ${pts[1][0]} ${pts[1][1]}` : ""}`;
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/** 直角折线路径（城市道路） */
function straightPath(points: Array<[number, number]>): string {
  return points.map(([x, y], index) => {
    const [sx, sy] = iso(x, y);
    return `${index === 0 ? "M" : "L"} ${sx.toFixed(1)} ${sy.toFixed(1)}`;
  }).join(" ");
}

function samplePolyline(points: Array<[number, number]>, step: number): Array<[number, number]> {
  const samples: Array<[number, number]> = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const length = Math.hypot(x1 - x0, y1 - y0);
    const count = Math.max(1, Math.ceil(length / step));
    for (let k = 0; k <= count; k += 1) samples.push([x0 + ((x1 - x0) * k) / count, y0 + ((y1 - y0) * k) / count]);
  }
  return samples;
}

const ROAD_SAMPLES = ROADS.flatMap((road) => samplePolyline(road.points, .3));
const RIVER_SAMPLES = samplePolyline(RIVER_POINTS, .3);

function inMountains(x: number, y: number): boolean {
  return MOUNTAIN_SEGMENTS.some(({ yStart, yEnd, xBase }) => {
    const xMin = (xBase ?? MOUNTAIN_AXIS_X) - 1.8;
    const xMax = (xBase ?? MOUNTAIN_AXIS_X) + 1.85;
    return y > yStart - .2 && y < yEnd + .2 && x > xMin && x < xMax;
  });
}

/** 沿主要道路两侧种树 */
const TREE_LINED_ROADS = [0, 2, 3, 4, 6, 7];
const ROAD_TREES = TREE_LINED_ROADS.flatMap((roadIndex, ti) => {
  const road = ROADS[roadIndex];
  const trees: Array<{ x: number; y: number; scale: number }> = [];
  for (let i = 0; i < road.points.length - 1; i += 1) {
    const [x0, y0] = road.points[i];
    const [x1, y1] = road.points[i + 1];
    const length = Math.hypot(x1 - x0, y1 - y0);
    const nx = (-(y1 - y0) / length) * .58;
    const ny = ((x1 - x0) / length) * .58;
    const count = Math.floor(length / 1.35);
    for (let k = 1; k < count; k += 1) {
      const t = k / count;
      const side = (k + ti) % 2 === 0 ? 1 : -1;
      const x = x0 + (x1 - x0) * t + nx * side;
      const y = y0 + (y1 - y0) * t + ny * side;
      if (y < -0.35 || inMountains(x, y)) continue;
      if (LANDMARKS.some((l) => Math.hypot(l.x - x, l.y - y) < .9)) continue;
      if (STAKEHOLDERS.some((s) => Math.hypot(s.x - x, s.y - y) < .7)) continue;
      if (PARKS.some((p) => Math.abs(p.x - x) < p.w / 2 + .3 && Math.abs(p.y - y) < p.d / 2 + .3)) continue;
      trees.push({ x, y, scale: .55 + ((k * 31 + ti * 17) % 30) / 100 });
    }
  }
  return trees;
});

const VIEWBOX_HEIGHT_RATIO = 2453 / 4300;
/** 全景取景覆盖双城主体以及沿山脉中轴新增的上下两端区域 */
const defaultViewport = { x: -1450, y: -400, width: 4600, height: 4600 * VIEWBOX_HEIGHT_RATIO };

function activateOnKeyboard(event: KeyboardEvent<SVGGElement>, activate: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activate();
  }
}

interface Corner { sx: number; sy: number }

/**
 * 体块：顶面 + 两个侧面 + 落地阴影 + 窗格 + 可选屋顶设备。
 * 支持绕中心旋转（rot，弧度）；窗格为逐层逐列的玻璃小格，写实风格。
 */
function IsoBox({ x, y, w, d, h, lift = 0, rot = 0, top = "#f7f6f2", side = "#e2e4e6", shade = "#d0d3d6", shadow = false, windows = "none", ac = false }: {
  x: number; y: number; w: number; d: number; h: number; lift?: number; rot?: number;
  top?: string; side?: string; shade?: string; shadow?: boolean; windows?: "grid" | "stripes" | "none"; ac?: boolean;
}) {
  const hw = w / 2;
  const hd = d / 2;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const corners: Corner[] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([cx, cy]) => {
    const rx = cx * cos - cy * sin;
    const ry = cx * sin + cy * cos;
    const [sx, sy] = iso(x + rx, y + ry);
    return { sx, sy };
  });
  const pt = (c: Corner, l: number) => `${c.sx},${c.sy - l}`;
  let bi = 0;
  corners.forEach((c, i) => { if (c.sy > corners[bi].sy) bi = i; });
  const bottom = corners[bi];
  const right = corners[(bi + 1) % 4];
  const left = corners[(bi + 3) % 4];

  let windowPath = "";
  const stripeLines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  if (windows === "grid" && h > 26) {
    const segments: string[] = [];
    ([[bottom, right], [bottom, left]] as Array<[Corner, Corner]>).forEach(([a, nb]) => {
      const ex = nb.sx - a.sx;
      const ey = nb.sy - a.sy;
      const cols = Math.max(1, Math.floor(Math.hypot(ex, ey) / 21));
      const rows = Math.max(1, Math.min(4, Math.floor(h / 23)));
      const ux = ex / cols;
      const uy = ey / cols;
      const rowH = h / rows;
      const winH = Math.max(3.2, rowH * .4);
      for (let c = 0; c < cols; c += 1) {
        for (let r = 0; r < rows; r += 1) {
          const px = a.sx + ux * (c + .26);
          const py = a.sy - (lift + h) + uy * (c + .26) + rowH * r + rowH * .26;
          segments.push(`M ${px.toFixed(1)} ${py.toFixed(1)} l ${(ux * .48).toFixed(1)} ${(uy * .48).toFixed(1)} l 0 ${winH.toFixed(1)} l ${(-ux * .48).toFixed(1)} ${(-uy * .48).toFixed(1)} Z`);
        }
      }
    });
    windowPath = segments.join(" ");
  }
  if (windows === "stripes" && h > 26) {
    const rows = Math.max(1, Math.min(3, Math.floor(h / 30)));
    for (let r = 0; r < rows; r += 1) {
      const yy = lift + h * (.32 + (r / Math.max(1, rows)) * .5);
      stripeLines.push(
        { x1: bottom.sx, y1: bottom.sy - yy, x2: right.sx, y2: right.sy - yy },
        { x1: bottom.sx, y1: bottom.sy - yy, x2: left.sx, y2: left.sy - yy },
      );
    }
  }
  return <g>
    {shadow && <polygon points={corners.map((c) => `${c.sx + 10},${c.sy + 6}`).join(" ")} fill="#3c4442" opacity=".1" />}
    <polygon points={`${pt(bottom, lift + h)} ${pt(right, lift + h)} ${pt(right, lift)} ${pt(bottom, lift)}`} fill={shade} />
    <polygon points={`${pt(bottom, lift + h)} ${pt(left, lift + h)} ${pt(left, lift)} ${pt(bottom, lift)}`} fill={side} />
    <polygon points={corners.map((c) => pt(c, lift + h)).join(" ")} fill={top} />
    {windowPath && <path d={windowPath} fill="rgba(58,72,82,.32)" />}
    {stripeLines.map((line, index) => <line key={index} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="rgba(105,116,122,.4)" strokeWidth="2.4" />)}
    {ac && <>
      <IsoBox x={x + w * .22} y={y - d * .18} w={.14} d={.14} h={6} lift={lift + h} rot={rot} top="#c6cacd" side="#aeb3b7" shade="#9ba1a5" />
      <IsoBox x={x - w * .18} y={y + d * .14} w={.11} d={.11} h={5} lift={lift + h} rot={rot} top="#c6cacd" side="#aeb3b7" shade="#9ba1a5" />
    </>}
  </g>;
}

/** 建筑屋顶印字：写在顶面上，沿屋脊方向排列，深色字用于浅色顶、白色字用于色板顶 */
const ROOF_TEXT_LINES: Record<string, string[]> = {
  "招商促进局": ["招商", "促进局"],
  "财政审查局": ["财政", "审查局"],
  "城市决策中心": ["城市决策", "中心"],
  "成渝协调中心": ["成渝协调", "中心"],
  "政策审计中心": ["政策审计", "中心"],
  "企业董事会": ["企业", "董事会"],
  "CEO 战略室": ["CEO", "战略室"],
  "CFO 财务室": ["CFO", "财务室"],
  "尽调数据站": ["尽调", "数据站"],
  "资源计算站": ["资源", "计算站"],
  "人才与中小企业": ["人才与", "中小企业"],
};

function splitRoofText(text: string): string[] {
  if (ROOF_TEXT_LINES[text]) return ROOF_TEXT_LINES[text];
  const spaced = text.trim().split(/\s+/);
  if (spaced.length === 2) return spaced;
  const chars = [...text];
  if (chars.length <= 4) return [text];
  const splitAt = Math.ceil(chars.length / 2);
  return [chars.slice(0, splitAt).join(""), chars.slice(splitAt).join("")];
}

function RoofText({ x, y, h, lift = 0, dy = 0, text, size = 11, light = false }: {
  x: number; y: number; h: number; lift?: number; dy?: number; text: string; size?: number; light?: boolean;
}) {
  const [sx, sy] = iso(x, y + dy);
  const lines = splitRoofText(text);
  const lineHeight = size * .94;
  return <text
    transform={`translate(${sx.toFixed(1)} ${(sy - lift - h).toFixed(1)}) rotate(26.57)`}
    textAnchor="middle"
    dominantBaseline="central"
    fontSize={size}
    fontWeight="850"
    fill={light ? "#ffffff" : "#26342f"}
    stroke={light ? "rgba(38,52,47,.48)" : "rgba(255,255,255,.72)"}
    strokeWidth={light ? 1.6 : 1.25}
    paintOrder="stroke"
    opacity=".98"
  >
    {lines.map((line, index) => <tspan key={line} x="0" dy={index === 0 ? -((lines.length - 1) * lineHeight) / 2 : lineHeight}>{line}</tspan>)}
  </text>;
}

function Tree({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  const [sx, sy] = iso(x, y);
  return <g transform={`translate(${sx} ${sy}) scale(${scale})`}>
    <rect x="-2.4" y="-13" width="4.8" height="13" fill="#8a6f52" />
    <polygon points="-13,-8 13,-8 0,-34" fill="#5e9a6d" />
    <polygon points="-9,-24 9,-24 0,-46" fill="#6fae7c" />
  </g>;
}

/** 路面行驶的汽车，沿道路折线循环移动 */
function Car({ roadIndex, color, duration, begin }: { roadIndex: number; color: string; duration: number; begin: string }) {
  return <g>
    <rect x="-13" y="-6.5" width="26" height="13" rx="4.5" fill={color} stroke="rgba(30,36,34,.25)" strokeWidth="1" />
    <rect x="-2" y="-5" width="9" height="10" rx="2.5" fill="rgba(24,32,40,.55)" />
    <animateMotion dur={`${duration}s`} begin={begin} repeatCount="indefinite" rotate="auto">
      <mpath href={`#twin-road-${roadIndex}`} />
    </animateMotion>
  </g>;
}

/** 锯齿山脉：折面山峰，左暗右亮，高峰带雪顶 */
function Peak({ x, y, s, h, snow }: { x: number; y: number; s: number; h: number; snow?: boolean }) {
  const [sx, sy] = iso(x, y);
  return <g>
    <polygon points={`${sx - s},${sy} ${sx},${sy} ${sx},${sy - h}`} fill="#879b7e" />
    <polygon points={`${sx},${sy} ${sx + s},${sy} ${sx},${sy - h}`} fill="#a7bb9e" />
    {snow && <polygon points={`${(sx - s * .2).toFixed(1)},${(sy - h * .8).toFixed(1)} ${(sx + s * .2).toFixed(1)},${(sy - h * .8).toFixed(1)} ${sx},${sy - h}`} fill="#f5f7f4" />}
  </g>;
}

function MountainRange({ yStart, yEnd, xBase = MOUNTAIN_AXIS_X }: { yStart: number; yEnd: number; xBase?: number }) {
  const { ridge, band } = useMemo(() => {
    const pts: Array<{ x: number; y: number }> = [];
    let i = 0;
    for (let y = yStart; y <= yEnd + .01; y += 1.05, i += 1) {
      pts.push({ x: xBase + (i % 2 === 0 ? -1 : 1) * (.75 + ((i * 41) % 40) / 100), y });
    }
    const left = pts.map((p) => isoPoint(p.x - 1.15, p.y)).join(" ");
    const right = [...pts].reverse().map((p) => isoPoint(p.x + 1.15, p.y)).join(" ");
    return { ridge: pts, band: `${left} ${right}` };
  }, [yStart, yEnd, xBase]);
  return <g>
    <polygon points={band} fill="#c3cebb" />
    {ridge.map((p, index) => {
      const seed = (index * 67) % 100;
      return <g key={index}>
        <Peak x={p.x} y={p.y} s={38 + seed * .16} h={42 + seed * .3} snow={seed % 3 === 0} />
        {index < ridge.length - 1 && <Peak x={(p.x + ridge[index + 1].x) / 2} y={p.y + .52} s={22 + (seed % 30) * .3} h={24 + (seed % 20)} />}
        <Peak x={p.x - .95} y={p.y + .3} s={17 + (seed % 20) * .4} h={17 + (seed % 14)} />
        <Peak x={p.x + .95} y={p.y - .25} s={16 + (seed % 24) * .35} h={16 + (seed % 12)} />
      </g>;
    })}
  </g>;
}

function LandmarkGeometry({ kind, color }: { kind: LandmarkKind; color: string }) {
  const body = { top: tint(color, .68), side: tint(color, .5), shade: tint(color, .36), windows: "grid" as const, ac: true };
  if (kind === "leader") return <>
    <IsoBox x={0} y={0} w={.92} d={.92} h={118} {...body} />
    <IsoBox x={0} y={-.14} w={.46} d={.46} h={12} lift={118} top={color} side={darken(color, .12)} shade={darken(color, .22)} />
    <IsoBox x={0} y={-.14} w={.14} d={.14} h={26} lift={130} top={tint(color, .4)} side={tint(color, .3)} shade={tint(color, .2)} />
  </>;
  if (kind === "investment") return <>
    <IsoBox x={-.16} y={0} w={.72} d={.8} h={88} {...body} />
    <IsoBox x={-.16} y={-.12} w={.44} d={.44} h={10} lift={88} top={color} side={darken(color, .12)} shade={darken(color, .22)} />
    <IsoBox x={.5} y={.1} w={.5} d={.55} h={46} top={tint(color, .8)} side={tint(color, .62)} shade={tint(color, .5)} windows="stripes" />
    <IsoBox x={.5} y={.1} w={.42} d={.47} h={8} lift={46} top={tint(color, .3)} side={tint(color, .2)} shade={tint(color, .12)} />
  </>;
  if (kind === "finance") return <>
    <IsoBox x={0} y={0} w={1.3} d={.95} h={56} {...body} />
    <IsoBox x={0} y={0} w={1.38} d={1.02} h={10} lift={56} top={color} side={darken(color, .12)} shade={darken(color, .22)} />
  </>;
  if (kind === "company") return <>
    <IsoBox x={0} y={0} w={.84} d={.78} h={76} {...body} />
    <IsoBox x={0} y={-.12} w={.46} d={.42} h={10} lift={76} top={color} side={darken(color, .12)} shade={darken(color, .22)} />
  </>;
  return <>
    <IsoBox x={0} y={0} w={.94} d={.8} h={36} {...body} ac={false} />
    <IsoBox x={0} y={0} w={1} d={.86} h={8} lift={36} top={color} side={darken(color, .12)} shade={darken(color, .22)} />
    <IsoBox x={0} y={-.3} w={.08} d={.08} h={22} lift={44} top="#9aa5ae" side="#8b96a0" shade="#7f8a94" />
  </>;
}

/** 屋顶印字参数：浅色顶面用深色字并前移避开屋顶设备，色板顶用白字 */
const LANDMARK_ROOF_TEXT: Record<LandmarkKind, { x: number; y: number; h: number; lift?: number; dy?: number; size: number; light?: boolean }> = {
  leader: { x: 0, y: 0, h: 118, dy: .3, size: 14 },
  investment: { x: -.16, y: 0, h: 88, dy: .3, size: 13 },
  finance: { x: 0, y: 0, h: 10, lift: 56, size: 14.5, light: true },
  company: { x: 0, y: 0, h: 76, dy: .3, size: 13 },
  service: { x: 0, y: 0, h: 8, lift: 36, size: 11.5, light: true },
};

function Landmark({ spec, activeActorId, organizationMode = false, onHoverActor, onSelectActor }: { spec: LandmarkSpec; activeActorId?: string; organizationMode?: boolean; onHoverActor?: (actorId?: string) => void; onSelectActor: (actorId: string) => void }) {
  const active = activeActorId === spec.actorId;
  const activate = () => onSelectActor(spec.actorId);
  const [sx, sy] = iso(spec.x, spec.y);
  const roofText = LANDMARK_ROOF_TEXT[spec.kind];
  const displayText = { ...roofText, size: roofText.size * 1.52 };
  const height = spec.kind === "leader" ? 156 : spec.kind === "investment" ? 98 : spec.kind === "company" ? 86 : spec.kind === "finance" ? 66 : 66;
  return <g
    className={`fallback-semantic-building ${active ? "active" : ""} ${organizationMode ? "organization-node" : ""}`}
    transform={`translate(${sx} ${sy})`}
    role="button"
    tabIndex={0}
    aria-label={`查看${spec.city}${spec.label}`}
    onClick={activate}
    onKeyDown={(event) => activateOnKeyboard(event, activate)}
    onPointerEnter={() => organizationMode && onHoverActor?.(spec.actorId)}
    onPointerLeave={() => organizationMode && onHoverActor?.()}
    onFocus={() => organizationMode && onHoverActor?.(spec.actorId)}
    onBlur={() => organizationMode && onHoverActor?.()}
  >
    {organizationMode && <>
      <ellipse className="organization-node-halo" cx="0" cy="7" rx={spec.kind === "finance" ? 82 : 68} ry={spec.kind === "finance" ? 38 : 32} fill={spec.color} stroke={spec.color} strokeWidth="4" />
      <circle className="organization-node-dot" cx="0" cy={-height - 24} r="9" fill={spec.color} stroke="#fff" strokeWidth="4" />
    </>}
    {active && <><ellipse className="fallback-active-ring" cx="0" cy="6" rx="78" ry="36" fill="none" stroke={spec.color} strokeWidth="4" /><circle className="fallback-action-pulse" cx="0" cy={-height - 26} r="10" fill={spec.color} /></>}
    <polygon points={`${isoPoint(-.75, -.55)} ${isoPoint(.95, -.15)} ${isoPoint(.55, .8)} ${isoPoint(-1.15, .4)}`} fill="#3c4442" opacity=".12" transform="translate(11 7)" />
    <g className="fallback-building-body">
      <LandmarkGeometry kind={spec.kind} color={spec.color} />
      <RoofText {...displayText} text={spec.label} />
    </g>
  </g>;
}

/** 坡顶小屋（居民代表）：墙体 + 双坡屋顶 */
function PitchedHouse({ color }: { color: string }) {
  const w = .62;
  const d = .56;
  const h = 26;
  const rh = 16;
  const A = { p: isoPoint(-w / 2, -d / 2, h), q: isoPoint(-w / 2, -d / 2, 0) };
  const B = { p: isoPoint(w / 2, -d / 2, h), q: isoPoint(w / 2, -d / 2, 0) };
  const C = { p: isoPoint(w / 2, d / 2, h), q: isoPoint(w / 2, d / 2, 0) };
  const D = { p: isoPoint(-w / 2, d / 2, h), q: isoPoint(-w / 2, d / 2, 0) };
  const R1 = isoPoint(-w / 2, 0, h + rh);
  const R2 = isoPoint(w / 2, 0, h + rh);
  return <g>
    <polygon points={`${B.p} ${C.p} ${C.q} ${B.q}`} fill={tint(color, .42)} />
    <polygon points={`${D.p} ${C.p} ${C.q} ${D.q}`} fill={tint(color, .58)} />
    <polygon points={`${A.p} ${B.p} ${C.p} ${D.p}`} fill={tint(color, .72)} />
    <polygon points={`${D.p} ${C.p} ${R2} ${R1}`} fill={darken(color, .08)} />
    <polygon points={`${C.p} ${B.p} ${R2}`} fill={darken(color, .22)} />
  </g>;
}

function Stakeholder({ actorId, label, x, y, color, kind, activeActorId, organizationMode = false, onHoverActor, onSelectActor }: { actorId: string; label: string; x: number; y: number; color: string; kind: "office" | "block" | "house"; activeActorId?: string; organizationMode?: boolean; onHoverActor?: (actorId?: string) => void; onSelectActor: (actorId: string) => void }) {
  const active = activeActorId === actorId;
  const activate = () => onSelectActor(actorId);
  const [sx, sy] = iso(x, y);
  const height = kind === "office" ? 70 : kind === "block" ? 43 : 42;
  return <g transform={`translate(${sx} ${sy})`} role="button" tabIndex={0} aria-label={`查看${label}`} className={`fallback-semantic-building ${active ? "active" : ""} ${organizationMode ? "organization-node" : ""}`} onClick={activate} onKeyDown={(event) => activateOnKeyboard(event, activate)} onPointerEnter={() => organizationMode && onHoverActor?.(actorId)} onPointerLeave={() => organizationMode && onHoverActor?.()} onFocus={() => organizationMode && onHoverActor?.(actorId)} onBlur={() => organizationMode && onHoverActor?.()}>
    {organizationMode && <>
      <ellipse className="organization-node-halo" cx="0" cy="6" rx="58" ry="28" fill={color} stroke={color} strokeWidth="4" />
      <circle className="organization-node-dot" cx="0" cy={-height - 20} r="8" fill={color} stroke="#fff" strokeWidth="4" />
    </>}
    {active && <><ellipse className="fallback-active-ring" cx="0" cy="5" rx="52" ry="24" fill="none" stroke={color} strokeWidth="3.5" /><circle className="fallback-action-pulse" cx="0" cy={-height - 20} r="8" fill={color} /></>}
    <polygon points={`${isoPoint(-.55, -.4)} ${isoPoint(.65, -.1)} ${isoPoint(.4, .55)} ${isoPoint(-.8, .25)}`} fill="#3c4442" opacity=".11" transform="translate(9 6)" />
    <g className="fallback-building-body">
      {kind === "house" ? <>
        <PitchedHouse color={color} />
        <RoofText x={0} y={0} h={33} dy={.16} text={label} size={15} light />
      </> : kind === "office" ? <>
        <IsoBox x={0} y={0} w={.58} d={.55} h={62} top={tint(color, .68)} side={tint(color, .5)} shade={tint(color, .36)} windows="grid" ac />
        <IsoBox x={0} y={-.1} w={.36} d={.34} h={8} lift={62} top={color} side={darken(color, .12)} shade={darken(color, .22)} />
        <RoofText x={0} y={0} h={62} dy={.22} text={label} size={17} />
      </> : <>
        <IsoBox x={0} y={0} w={.88} d={.62} h={36} top={tint(color, .7)} side={tint(color, .54)} shade={tint(color, .4)} windows="stripes" />
        <IsoBox x={0} y={0} w={.94} d={.68} h={7} lift={36} top={color} side={darken(color, .12)} shade={darken(color, .22)} />
        <RoofText x={0} y={0} h={7} lift={36} text={label} size={16} light />
      </>}
    </g>
  </g>;
}

function organizationNodePoint(actorId: string): [number, number] | undefined {
  const spec = ORG_MEMBER_STYLE.get(actorId);
  if (!spec) return undefined;
  const [sx, sy] = iso(spec.x, spec.y);
  const lift = ({ leader: 92, investment: 70, finance: 50, company: 62, service: 36, office: 52, block: 32, house: 30 } as Record<string, number>)[spec.kind] ?? 44;
  return [sx, sy - lift];
}

function OrganizationRelations({ groups, phase, hoveredActorId }: { groups: OrganizationLayerGroup[]; phase: "lines" | "labels"; hoveredActorId?: string }) {
  const visibleActors = new Set(groups.flatMap((group) => group.members.map((member) => member.actorId)));
  return <g className={`org-relation-layer org-relation-${phase}`} pointerEvents="none">
    {ORGANIZATION_RELATIONSHIPS.filter((relation) => visibleActors.has(relation.from) && visibleActors.has(relation.to)).map((relation) => {
      const start = organizationNodePoint(relation.from);
      const end = organizationNodePoint(relation.to);
      if (!start || !end) return null;
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const length = Math.max(1, Math.hypot(dx, dy));
      const curve = relation.curve ?? 0;
      const controlX = (start[0] + end[0]) / 2 + (-dy / length) * curve;
      const controlY = (start[1] + end[1]) / 2 + (dx / length) * curve;
      const labelX = (start[0] + 2 * controlX + end[0]) / 4;
      const labelY = (start[1] + 2 * controlY + end[1]) / 4;
      const path = `M ${start[0].toFixed(1)} ${start[1].toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${end[0].toFixed(1)} ${end[1].toFixed(1)}`;
      const toneColor = ORG_RELATION_COLORS[relation.tone];
      const connected = Boolean(hoveredActorId && (relation.from === hoveredActorId || relation.to === hoveredActorId));
      const inspecting = Boolean(hoveredActorId);
      const color = connected ? toneColor : "#87928d";
      const opacity = inspecting ? (connected ? 1 : .2) : .68;
      const marker = connected ? `url(#org-arrow-${relation.tone})` : "url(#org-arrow-muted)";
      const labelWidth = Math.max(86, [...relation.label].length * 17 + 30);
      const dashed = relation.tone === "advice" || relation.tone === "service" || relation.tone === "stakeholder";
      return <g className={`org-relation tone-${relation.tone} ${connected ? "is-connected" : inspecting ? "is-muted" : "is-idle"}`} opacity={opacity} key={`${phase}-${relation.from}-${relation.to}-${relation.label}`}>
        {phase === "lines" ? <>
          <path d={path} fill="none" stroke="rgba(248,250,248,.94)" strokeWidth="12" strokeLinecap="round" />
          <path d={path} fill="none" stroke={color} strokeWidth={connected ? 5.8 : 4.2} strokeLinecap="round" strokeDasharray={dashed ? "11 8" : undefined} markerStart={relation.bidirectional ? marker : undefined} markerEnd={marker} />
        </> : <>
          <rect x={labelX - labelWidth / 2} y={labelY - 18} width={labelWidth} height="36" rx="18" fill="#fafbf9" stroke={color} strokeWidth="1.7" />
          <text x={labelX} y={labelY + 6} textAnchor="middle" fill={color} fontSize="16.5" fontWeight="820" letterSpacing="1">{relation.label}</text>
        </>}
      </g>;
    })}
  </g>;
}

/** 无名环境建筑：白色体块、随机微转角、窗格与屋顶设备，避开道路、山脉、地标与公园 */
interface AmbientBlock { x: number; y: number; w: number; d: number; h: number; tone: number; shape: number; rot: number; ac: boolean; winStyle: "grid" | "stripes" | "none" }

/** 星岚加工园房区：两排规则白模，不生成道路，也不使用随机散点 */
const ROBOT_PROCESSING_BLOCKS: AmbientBlock[] = [
  { x: 7.0, y: -5.75, w: .62, d: .58, h: 34, tone: 0, shape: 0, rot: 0, ac: true, winStyle: "grid" },
  { x: 9.0, y: -5.75, w: .72, d: .6, h: 46, tone: 1, shape: 2, rot: 0, ac: true, winStyle: "stripes" },
  { x: 11.2, y: -5.75, w: .64, d: .62, h: 38, tone: 0, shape: 0, rot: 0, ac: false, winStyle: "grid" },
  { x: 13.2, y: -5.75, w: .7, d: .58, h: 43, tone: 2, shape: 2, rot: 0, ac: true, winStyle: "grid" },
  { x: 7.1, y: -3.0, w: .68, d: .56, h: 28, tone: 2, shape: 0, rot: 0, ac: false, winStyle: "stripes" },
  { x: 9.2, y: -3.0, w: .6, d: .6, h: 39, tone: 0, shape: 2, rot: 0, ac: true, winStyle: "grid" },
  { x: 11.4, y: -3.0, w: .72, d: .58, h: 32, tone: 1, shape: 0, rot: 0, ac: false, winStyle: "grid" },
  { x: 13.5, y: -3.0, w: .64, d: .62, h: 41, tone: 0, shape: 2, rot: 0, ac: true, winStyle: "stripes" },
];

function useAmbientBlocks() {
  return useMemo(() => {
    const zones = [
      { x0: .1, x1: 8.0, y0: -.4, y1: 13.5, count: 88 },
      { x0: 12.3, x1: 19.9, y0: -.4, y1: 13.5, count: 95 },
      { x0: 7.0, x1: 13.8, y0: 15.8, y1: 18.2, count: 12 },
    ];
    const result: AmbientBlock[] = [];
    zones.forEach((zone, zi) => {
      let placed = 0;
      for (let attempt = 0; attempt < zone.count * 6 && placed < zone.count; attempt += 1) {
        const seed = zi * 1009 + attempt * 73;
        const x = zone.x0 + ((seed * 37) % 100) / 100 * (zone.x1 - zone.x0);
        const y = zone.y0 + ((seed * 53) % 100) / 100 * (zone.y1 - zone.y0);
        if (inMountains(x, y)) continue;
        if (RIVER_SAMPLES.some(([rx, ry]) => Math.hypot(rx - x, ry - y) < .85)) continue;
        if (ROAD_SAMPLES.some(([rx, ry]) => Math.hypot(rx - x, ry - y) < .62)) continue;
        if (LANDMARKS.some((l) => Math.hypot(l.x - x, l.y - y) < (AMBIENT_CLEARANCE_BY_ACTOR[l.actorId] ?? 1.1))) continue;
        if (STAKEHOLDERS.some((s) => Math.hypot(s.x - x, s.y - y) < (AMBIENT_CLEARANCE_BY_ACTOR[s.actorId] ?? .8))) continue;
        if (PARKS.some((p) => Math.abs(p.x - x) < p.w / 2 + .25 && Math.abs(p.y - y) < p.d / 2 + .25)) continue;
        if (result.some((b) => Math.hypot(b.x - x, b.y - y) < .58)) continue;
        result.push({
          x, y,
          w: .38 + ((seed * 13) % 45) / 100,
          d: .36 + ((seed * 17) % 40) / 100,
          h: 15 + ((seed * 7) % 100) / 100 * 68,
          tone: (seed * 11) % 3,
          shape: (seed * 5) % 5,
          rot: (((seed * 3) % 25) - 12) * .012,
          ac: (seed * 29) % 3 === 0,
          winStyle: (["none", "grid", "stripes", "grid"] as const)[(seed * 19) % 4],
        });
        placed += 1;
      }
    });
    result.push(...ROBOT_PROCESSING_BLOCKS);
    return result.sort((a, b) => a.x + a.y - (b.x + b.y));
  }, []);
}

const AMBIENT_TONES = [
  { top: "#f4f5f6", side: "#e3e5e7", shade: "#d2d5d8" },
  { top: "#eceff0", side: "#dde0e2", shade: "#ccd0d3" },
  { top: "#f6f4ee", side: "#e6e4de", shade: "#d6d3cc" },
];

function AmbientBuilding({ block }: { block: AmbientBlock }) {
  const tone = AMBIENT_TONES[block.tone];
  const { x, y, w, d, h, rot, ac } = block;
  const base = { rot, shadow: true, windows: block.winStyle as "grid" | "stripes" | "none" };
  if (block.shape === 1) return <>
    <IsoBox x={x - w * .22} y={y} w={w * .55} d={d} h={h} {...tone} {...base} ac={ac} />
    <IsoBox x={x + w * .3} y={y + d * .18} w={w * .5} d={d * .75} h={h * .55} {...tone} {...base} />
  </>;
  if (block.shape === 2) return <>
    <IsoBox x={x} y={y} w={w} d={d} h={h} {...tone} {...base} ac={ac} />
    <IsoBox x={x} y={y} w={w * .7} d={d * .7} h={Math.max(6, h * .12)} lift={h} rot={rot} top={tone.side} side={tone.shade} shade={tone.shade} />
  </>;
  if (block.shape === 3) return <IsoBox x={x} y={y} w={w * 1.5} d={d * .8} h={h * .55} {...tone} {...base} ac={ac} />;
  if (block.shape === 4) return <IsoBox x={x} y={y} w={w * .62} d={d * .62} h={h * 1.5} {...tone} {...base} ac={ac} />;
  return <IsoBox x={x} y={y} w={w} d={d} h={h} {...tone} {...base} ac={ac} />;
}

export function FallbackTwin({ activeActorId, organizationLayer, onDeselectActor, onAnchorPositions, onSelectVisualKey, onSelectActor }: FallbackTwinProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ clientX: number; clientY: number; x: number; y: number } | undefined>(undefined);
  const followFrameRef = useRef<number | undefined>(undefined);
  const viewportRef = useRef(defaultViewport);
  const [viewport, setViewport] = useState(defaultViewport);
  const [dragging, setDragging] = useState(false);
  const [hoveredOrgActorId, setHoveredOrgActorId] = useState<string>();
  const ambientBlocks = useAmbientBlocks();

  const source = activeActorId ? LANDMARKS.find((l) => l.actorId === activeActorId) ?? STAKEHOLDERS.find((s) => s.actorId === activeActorId) : undefined;
  const [coreSx, coreSy] = iso(PROJECT_CORE.x, PROJECT_CORE.y);

  useEffect(() => { viewportRef.current = viewport; }, [viewport]);
  useEffect(() => { if (!organizationLayer) setHoveredOrgActorId(undefined); }, [organizationLayer]);

  const cancelCameraFollow = () => {
    if (followFrameRef.current !== undefined) window.cancelAnimationFrame(followFrameRef.current);
    followFrameRef.current = undefined;
  };

  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    setViewport((current) => {
      const nextWidth = Math.min(5000, Math.max(1100, current.width * factor));
      const nextHeight = nextWidth * VIEWBOX_HEIGHT_RATIO;
      const canAnchor = rect && rect.width > 0 && rect.height > 0 && clientX !== undefined && clientY !== undefined;
      const anchorX = canAnchor ? current.x + ((clientX - rect.left) / rect.width) * current.width : current.x + current.width / 2;
      const anchorY = canAnchor ? current.y + ((clientY - rect.top) / rect.height) * current.height : current.y + current.height / 2;
      const x = anchorX - ((anchorX - current.x) / current.width) * nextWidth;
      const y = anchorY - ((anchorY - current.y) / current.height) * nextHeight;
      return { x, y, width: nextWidth, height: nextHeight };
    });
  };
  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    cancelCameraFollow();
    zoomAt(event.deltaY > 0 ? 1.12 : .88, event.clientX, event.clientY);
  };
  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest("[role='button']")) return;
    cancelCameraFollow();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { clientX: event.clientX, clientY: event.clientY, x: viewport.x, y: viewport.y };
    setDragging(true);
  };
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const start = dragRef.current;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!start || !rect) return;
    setViewport((current) => ({ ...current, x: start.x - (event.clientX - start.clientX) * (current.width / rect.width), y: start.y - (event.clientY - start.clientY) * (current.height / rect.height) }));
  };
  const stopDragging = (event?: ReactPointerEvent<SVGSVGElement>) => {
    const start = dragRef.current;
    dragRef.current = undefined;
    setDragging(false);
    // 原地点击地图空白处（非拖拽）→ 关闭 Agent X-Ray
    if (start && event && Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < 6) onDeselectActor?.();
  };
  // 切入组织剖面时，自动把视野缩放到能看清全部关系节点；切出时复原
  useEffect(() => {
    if (!organizationLayer) { setViewport(defaultViewport); return; }
    const boxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    organizationLayer.groups.forEach((group) => {
      group.members.forEach((member) => {
        const spec = ORG_MEMBER_STYLE.get(member.actorId);
        if (!spec) return;
        const [sx, sy] = iso(spec.x, spec.y);
        boxes.push({ x0: sx - 70, y0: sy - 150, x1: sx + 70, y1: sy + 60 });
      });
    });
    if (!boxes.length) return;
    const aspect = 1844 / 3400;
    const x0 = Math.min(...boxes.map((box) => box.x0)) - 150;
    const x1 = Math.max(...boxes.map((box) => box.x1)) + 150;
    const y0 = Math.min(...boxes.map((box) => box.y0)) - 240;
    const y1 = Math.max(...boxes.map((box) => box.y1)) + 130;
    let width = x1 - x0;
    let height = y1 - y0;
    if (height < width * aspect) height = width * aspect; else width = height / aspect;
    width = Math.min(3400, Math.max(1100, width));
    height = width * aspect;
    setViewport({ x: x0 - (width - (x1 - x0)) / 2, y: y0 - (height - (y1 - y0)) / 2, width, height });
  }, [organizationLayer]);

  useEffect(() => {
    if (!activeActorId || organizationLayer) return;
    const actor = LANDMARKS.find((item) => item.actorId === activeActorId) ?? STAKEHOLDERS.find((item) => item.actorId === activeActorId);
    if (!actor) return;
    cancelCameraFollow();
    const start = viewportRef.current;
    const [focusX, focusY] = iso(actor.x, actor.y);
    const width = Math.min(defaultViewport.width, 3600);
    const height = width * VIEWBOX_HEIGHT_RATIO;
    const target = { x: focusX - width * .5, y: focusY - 96 - height * .45, width, height };
    const startedAt = performance.now();
    const duration = 720;
    const animate = (now: number) => {
      const linear = Math.min(1, (now - startedAt) / duration);
      const eased = linear * linear * (3 - 2 * linear);
      const next = {
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
        width: start.width + (target.width - start.width) * eased,
        height: start.height + (target.height - start.height) * eased,
      };
      viewportRef.current = next;
      setViewport(next);
      if (linear < 1) followFrameRef.current = window.requestAnimationFrame(animate); else followFrameRef.current = undefined;
    };
    followFrameRef.current = window.requestAnimationFrame(animate);
    return cancelCameraFollow;
  }, [activeActorId, organizationLayer]);

  useEffect(() => {
    if (!onAnchorPositions) return;
    const publish = () => {
      const rect = svgRef.current?.getBoundingClientRect();
      const shellRect = shellRef.current?.getBoundingClientRect();
      if (!rect || !shellRect || rect.width <= 0 || rect.height <= 0) return;
      const scale = Math.min(rect.width / viewport.width, rect.height / viewport.height);
      const offsetX = rect.left - shellRect.left + (rect.width - viewport.width * scale) / 2;
      const offsetY = rect.top - shellRect.top + (rect.height - viewport.height * scale) / 2;
      const positions: Record<string, { left: number; top: number }> = {};
      [...LANDMARKS, ...STAKEHOLDERS].forEach((actor) => {
        const [sx, sy] = iso(actor.x, actor.y);
        const lift = "kind" in actor && actor.kind === "service" ? 78 : "kind" in actor && actor.kind === "house" ? 50 : 112;
        positions[actor.actorId] = {
          left: offsetX + (sx - viewport.x) * scale,
          top: offsetY + (sy - lift - viewport.y) * scale,
        };
      });
      onAnchorPositions(positions);
    };
    const frame = window.requestAnimationFrame(publish);
    window.addEventListener("resize", publish);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("resize", publish); };
  }, [onAnchorPositions, viewport]);

  const sortedLandmarks = [...LANDMARKS].sort((a, b) => a.x + a.y - (b.x + b.y));

  return <div ref={shellRef} className="fallback-twin-shell">
    <svg ref={svgRef} className={`fallback-twin ${dragging ? "dragging" : ""}`} viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} role="img" aria-label="CityScope 双城部门级 2.5D 沙盘" onWheel={handleWheel} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={stopDragging} onPointerCancel={() => stopDragging()}>
      <defs>
        {ROADS.map((road, index) => <path key={index} id={`twin-road-${index}`} d={straightPath(road.points)} />)}
        {ROADS.map((road, index) => {
          const [firstX] = iso(road.points[0][0], road.points[0][1]);
          const [lastX] = iso(road.points[road.points.length - 1][0], road.points[road.points.length - 1][1]);
          return <path key={`text-${index}`} id={`twin-road-text-${index}`} d={straightPath(lastX < firstX ? [...road.points].reverse() : road.points)} />;
        })}
        <path id="twin-river" d={smoothPath(RIVER_POINTS)} />
        <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="5" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#4a5652" /></marker>
        <marker id="org-arrow-muted" markerWidth="9" markerHeight="9" refX="7.5" refY="4.5" orient="auto-start-reverse"><path d="M0 0 L9 4.5 L0 9 Z" fill="#87928d" /></marker>
        {Object.entries(ORG_RELATION_COLORS).map(([tone, color]) => <marker key={tone} id={`org-arrow-${tone}`} markerWidth="9" markerHeight="9" refX="7.5" refY="4.5" orient="auto-start-reverse"><path d="M0 0 L9 4.5 L0 9 Z" fill={color} /></marker>)}
      </defs>

      {/* 地面：满铺浅灰，不留白 */}
      <rect x="-3600" y="-2400" width="9200" height="6800" fill="#d3d5d8" />

      {/* 两个片区的微妙底色区分 */}
      <polygon points={`${isoPoint(-1.8, -2.2)} ${isoPoint(8.2, -2.2)} ${isoPoint(8.2, 14.2)} ${isoPoint(-1.8, 14.2)}`} fill="#c6d2c5" opacity=".6" />
      <polygon points={`${isoPoint(12.2, -2.2)} ${isoPoint(21.5, -2.2)} ${isoPoint(21.5, 14.2)} ${isoPoint(12.2, 14.2)}`} fill="#d9d0c5" opacity=".6" />
      {/* 统筹协调区是双城底图的连续扩展，不使用独立悬浮地块 */}
      <polygon points={`${isoPoint(5.8, 13.3)} ${isoPoint(15.0, 13.3)} ${isoPoint(15.0, 19.4)} ${isoPoint(5.8, 19.4)}`} fill="#cbcbd0" opacity=".68" />

      {/* 河流与滨水绿带 */}
      <use href="#twin-river" stroke="#a9c8a2" strokeWidth="152" fill="none" strokeLinecap="butt" />
      <use href="#twin-river" stroke="#8fc3da" strokeWidth="118" fill="none" strokeLinecap="butt" />
      <text transform={`translate(${iso(3.6, -1.35)[0]} ${iso(3.6, -1.35)[1]}) rotate(24)`} fill="#ffffff" fontSize="21" fontWeight="650" letterSpacing="9" opacity=".95">府 南 河</text>
      <text transform={`translate(${iso(15.6, -1.35)[0]} ${iso(15.6, -1.35)[1]}) rotate(24)`} fill="#ffffff" fontSize="21" fontWeight="650" letterSpacing="9" opacity=".95">嘉 陵 江</text>

      {/* 龙泉山脉保持原长度；产业与统筹仅沿其两端的虚拟延伸方向布局 */}
      {MOUNTAIN_SEGMENTS.map((segment) => <MountainRange key={segment.yStart} {...segment} />)}

      {/* 城市道路：浅色路肩 + 深色沥青 + 白色虚线 + 路面印字，直行 + 直角转弯 */}
      {ROADS.map((road, index) => <g key={index}>
        <use href={`#twin-road-${index}`} stroke="#e6e7e9" strokeWidth={(road.width ?? 42) + 10} fill="none" strokeLinecap="butt" strokeLinejoin="bevel" />
        <use href={`#twin-road-${index}`} stroke="#43484f" strokeWidth={road.width ?? 42} fill="none" strokeLinecap="butt" strokeLinejoin="bevel" />
        <use href={`#twin-road-${index}`} stroke="#f2f3f4" strokeWidth="2.5" fill="none" strokeDasharray="14 12" opacity=".75" />
        <text fontSize="20" fontWeight="650" fill="#dfe1e3" letterSpacing="6" opacity=".92"><textPath href={`#twin-road-text-${index}`} startOffset={road.labelOffset ?? "50%"} textAnchor="middle" dy="-7">{road.name}</textPath></text>
      </g>)}

      {/* 沿道路的行道树 */}
      {ROAD_TREES.map((tree, index) => <Tree key={index} x={tree.x} y={tree.y} scale={tree.scale} />)}

      {/* 路面车辆 */}
      <Car roadIndex={0} color="#e8c13e" duration={16} begin="-2s" />
      <Car roadIndex={0} color="#5fb69a" duration={18} begin="-11s" />
      <Car roadIndex={1} color="#d9a83c" duration={14} begin="-6s" />
      <Car roadIndex={2} color="#5b84db" duration={19} begin="-8s" />
      <Car roadIndex={2} color="#e69a78" duration={17} begin="-15s" />
      <Car roadIndex={3} color="#54a8b8" duration={18} begin="-4s" />
      <Car roadIndex={4} color="#e87973" duration={15} begin="-5s" />
      <Car roadIndex={4} color="#e4b945" duration={17} begin="-12s" />
      <Car roadIndex={5} color="#6686bd" duration={16} begin="-9s" />
      <Car roadIndex={6} color="#9b83d5" duration={20} begin="-13s" />
      <Car roadIndex={7} color="#58b795" duration={18} begin="-7s" />
      <Car roadIndex={8} color="#58a9cf" duration={15} begin="-10s" />
      <Car roadIndex={9} color="#e48562" duration={17} begin="-3s" />
      <Car roadIndex={10} color="#638bd5" duration={12} begin="-3s" />
      <Car roadIndex={10} color="#7aa68e" duration={14} begin="-9s" />

      {/* 公园 */}
      {PARKS.map((park) => <g key={park.name}>
        <polygon points={`${isoPoint(park.x - park.w / 2, park.y - park.d / 2)} ${isoPoint(park.x + park.w / 2, park.y - park.d / 2)} ${isoPoint(park.x + park.w / 2, park.y + park.d / 2)} ${isoPoint(park.x - park.w / 2, park.y + park.d / 2)}`} fill="#a9cf9e" />
        <Tree x={park.x - park.w * .28} y={park.y - park.d * .18} scale={.9} />
        <Tree x={park.x + park.w * .3} y={park.y - park.d * .3} scale={.72} />
        <Tree x={park.x + park.w * .05} y={park.y + park.d * .32} scale={.8} />
        <text transform={`translate(${iso(park.x, park.y)[0]} ${iso(park.x, park.y)[1]}) rotate(26.57)`} fill="#557f4f" fontSize="14" fontWeight="700" letterSpacing="3" textAnchor="middle">{park.name}</text>
      </g>)}

      {/* 无名环境建筑白模 */}
      {ambientBlocks.map((block, index) => <AmbientBuilding key={index} block={block} />)}

      {/* 协作流：从当前 Actor 流向项目核心 */}
      {source && <g className="fallback-active-flow">
        <path d={`M ${iso(source.x, source.y)[0]} ${iso(source.x, source.y)[1] - 78} Q ${(iso(source.x, source.y)[0] + coreSx) / 2} ${Math.min(iso(source.x, source.y)[1], coreSy) - 190} ${coreSx} ${coreSy - 96}`} fill="none" stroke="#4a5652" strokeWidth="3" strokeDasharray="7 8" markerEnd="url(#flow-arrow)" />
        <circle r="6" fill="#d9a83c"><animateMotion dur="1.6s" repeatCount="indefinite" path={`M ${iso(source.x, source.y)[0]} ${iso(source.x, source.y)[1] - 78} Q ${(iso(source.x, source.y)[0] + coreSx) / 2} ${Math.min(iso(source.x, source.y)[1], coreSy) - 190} ${coreSx} ${coreSy - 96}`} /></circle>
      </g>}

      {/* 地标部门建筑（上色，名称印在立面） */}
      {!organizationLayer && sortedLandmarks.map((spec) => <Landmark key={spec.actorId} spec={spec} activeActorId={activeActorId} onSelectActor={onSelectActor} />)}
      {!organizationLayer && STAKEHOLDERS.map((stakeholder) => <Stakeholder key={stakeholder.actorId} {...stakeholder} activeActorId={activeActorId} onSelectActor={onSelectActor} />)}

      {/* 项目核心 */}
      <g className="fallback-project-core" role="button" tabIndex={0} aria-label="选择星岚机器人项目核心" transform={`translate(${coreSx} ${coreSy - 108})`} onClick={() => onSelectVisualKey("visual-project-core")} onKeyDown={(event) => activateOnKeyboard(event, () => onSelectVisualKey("visual-project-core"))}>
        <ellipse cx="0" cy="30" rx="52" ry="18" fill="none" stroke="#8b8578" strokeWidth="2" opacity=".5" />
        <polygon points="-17,-4 0,5 17,-4 0,-13" fill="#e8bd55" />
        <polygon points="-17,-4 0,5 0,27 -17,18" fill="#d9a83c" />
        <polygon points="0,5 17,-4 17,18 0,27" fill="#b98a2e" />
        <polygon points="0,-40 12,-28 0,-16 -12,-28" fill="#f0cd72" />
      </g>

      {/* 重点区域标语置于建筑之上，并锚定在各区域的留白带，避免道路和房屋遮挡 */}
      <g className="fallback-place-labels" pointerEvents="none">
        <text transform={`translate(${iso(-.65, 10.35)[0]} ${iso(-.65, 10.35)[1]}) rotate(26.57)`} fill="#708d80" stroke="rgba(226,235,229,.92)" strokeWidth="5" paintOrder="stroke" fontSize="46" fontWeight="850" letterSpacing="12">成都高新区</text>
        <text transform={`translate(${iso(20.45, 7.8)[0]} ${iso(20.45, 7.8)[1]}) rotate(-26.57)`} fill="#9b8075" stroke="rgba(239,232,226,.92)" strokeWidth="5" paintOrder="stroke" fontSize="46" fontWeight="850" letterSpacing="12" textAnchor="middle">重庆两江新区</text>
        <text transform={`translate(${iso(9.55, 6.7)[0]} ${iso(9.55, 6.7)[1]}) rotate(-26.57)`} fill="#6f846a" stroke="rgba(220,228,215,.88)" strokeWidth="4" paintOrder="stroke" fontSize="32" fontWeight="850" letterSpacing="9" textAnchor="middle">龙泉山脉</text>
        <text transform={`translate(${iso(10.15, -6.55)[0]} ${iso(10.15, -6.55)[1]}) rotate(26.57)`} fill="#9b823f" stroke="rgba(239,233,212,.94)" strokeWidth="5" paintOrder="stroke" fontSize="38" fontWeight="850" letterSpacing="9" textAnchor="middle">星岚机器人</text>
        <text transform={`translate(${iso(10.15, -6.0)[0]} ${iso(10.15, -6.0)[1]}) rotate(26.57)`} fill="#aa9562" stroke="rgba(239,233,212,.9)" strokeWidth="3.5" paintOrder="stroke" fontSize="19" fontWeight="750" letterSpacing="5" textAnchor="middle">总部选址与加工协同区</text>
        <text transform={`translate(${iso(10.15, 15.05)[0]} ${iso(10.15, 15.05)[1]}) rotate(26.57)`} fill="#756c83" stroke="rgba(232,229,237,.94)" strokeWidth="5" paintOrder="stroke" fontSize="34" fontWeight="850" letterSpacing="8" textAnchor="middle">双城统筹协调区</text>
      </g>

      {/* 组织剖面图层：压暗底图，关系线连接高亮且可点击的真实建筑 */}
      {organizationLayer && <g className="org-layer">
        <rect x="-3600" y="-2400" width="9200" height="6800" fill="#eceee9" opacity=".62" pointerEvents="none" />
        <OrganizationRelations groups={organizationLayer.groups} phase="lines" hoveredActorId={hoveredOrgActorId} />
        {sortedLandmarks.map((spec) => <Landmark key={spec.actorId} spec={spec} organizationMode onHoverActor={setHoveredOrgActorId} onSelectActor={onSelectActor} />)}
        {STAKEHOLDERS.map((stakeholder) => <Stakeholder key={stakeholder.actorId} {...stakeholder} organizationMode onHoverActor={setHoveredOrgActorId} onSelectActor={onSelectActor} />)}
        <OrganizationRelations groups={organizationLayer.groups} phase="labels" hoveredActorId={hoveredOrgActorId} />
      </g>}
    </svg>
  </div>;
}
