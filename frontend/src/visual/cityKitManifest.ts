/** Visual-only CityKit manifest. It is not a business contract or Fixture. */
export type VisualCity = "chengdu" | "chongqing";
export type VisualSequencePhase = "orientation" | "constructing" | "paused" | "reorganizing";
export type HeroAssetKind =
  | "campus"
  | "lab"
  | "housing"
  | "civic"
  | "transit"
  | "factory"
  | "warehouse"
  | "energy"
  | "tower";

export interface VisualHeroAsset {
  visualKey: string;
  domainNodeId: null;
  city: VisualCity;
  label: string;
  kind: HeroAssetKind;
  anchor: readonly [number, number, number];
  rotation: number;
}

export const visualHeroAssets: readonly VisualHeroAsset[] = [
  { visualKey: "visual-chengdu-rd-campus", domainNodeId: null, city: "chengdu", label: "研发总部组团", kind: "campus", anchor: [-2.55, 0, -1.2], rotation: -0.08 },
  { visualKey: "visual-chengdu-robotics-lab", domainNodeId: null, city: "chengdu", label: "机器人实验室", kind: "lab", anchor: [-1.35, 0, -1.75], rotation: 0.08 },
  { visualKey: "visual-chengdu-talent-housing", domainNodeId: null, city: "chengdu", label: "人才公寓", kind: "housing", anchor: [0.15, 0, -1.62], rotation: -0.04 },
  { visualKey: "visual-chengdu-finance-center", domainNodeId: null, city: "chengdu", label: "财政中心", kind: "tower", anchor: [1.9, 0, -1.05], rotation: 0.04 },
  { visualKey: "visual-chengdu-innovation-hall", domainNodeId: null, city: "chengdu", label: "创新路演厅", kind: "civic", anchor: [-1.75, 0, 0.22], rotation: 0 },
  { visualKey: "visual-chengdu-green-lab", domainNodeId: null, city: "chengdu", label: "绿色中试楼", kind: "lab", anchor: [0.32, 0, 0.18], rotation: 0.12 },
  { visualKey: "visual-chengdu-transit-hub", domainNodeId: null, city: "chengdu", label: "通勤枢纽", kind: "transit", anchor: [2.42, 0, 0.55], rotation: -0.1 },

  { visualKey: "visual-chongqing-smart-factory", domainNodeId: null, city: "chongqing", label: "智能工厂", kind: "factory", anchor: [-2.5, 0.22, -1.15], rotation: 0.06 },
  { visualKey: "visual-chongqing-supply-park", domainNodeId: null, city: "chongqing", label: "供应链园区", kind: "warehouse", anchor: [-1.2, 0.38, -1.78], rotation: -0.08 },
  { visualKey: "visual-chongqing-energy-node", domainNodeId: null, city: "chongqing", label: "能源节点", kind: "energy", anchor: [0.22, 0.52, -1.58], rotation: 0 },
  { visualKey: "visual-chongqing-finance-center", domainNodeId: null, city: "chongqing", label: "财政中心", kind: "tower", anchor: [1.9, 0.68, -1.02], rotation: -0.04 },
  { visualKey: "visual-chongqing-freight-terminal", domainNodeId: null, city: "chongqing", label: "山地货运站", kind: "transit", anchor: [-1.78, 0.26, 0.28], rotation: 0.08 },
  { visualKey: "visual-chongqing-worker-housing", domainNodeId: null, city: "chongqing", label: "人才与职工社区", kind: "housing", anchor: [0.48, 0.46, 0.18], rotation: -0.1 },
  { visualKey: "visual-chongqing-bridge-hub", domainNodeId: null, city: "chongqing", label: "立体交通枢纽", kind: "transit", anchor: [2.45, 0.82, 0.6], rotation: 0.12 },
] as const;

export const visualSequence = [
  { phase: "orientation", label: "双城定向", startsAt: 0, endsAt: 8 },
  { phase: "constructing", label: "分段施工", startsAt: 8, endsAt: 19 },
  { phase: "paused", label: "施工冻结", startsAt: 19, endsAt: 27 },
  { phase: "reorganizing", label: "资源重布线", startsAt: 27, endsAt: 36 },
] as const satisfies ReadonlyArray<{ phase: VisualSequencePhase; label: string; startsAt: number; endsAt: number }>;

export const VISUAL_SEQUENCE_DURATION_SECONDS = 36;
