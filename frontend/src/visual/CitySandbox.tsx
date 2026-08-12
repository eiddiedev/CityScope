import { Html, OrbitControls, RoundedBox } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { SemanticEffects } from "../../../contracts/v0/generated/types";
import type { VisualSequencePhase } from "./cityKitManifest";

export interface PerformanceSample {
  fps: number;
  drawCalls: number;
  triangles: number;
}

interface CitySandboxProps {
  selectedVisualKey: string;
  visualPhase: VisualSequencePhase;
  semanticEffects?: SemanticEffects;
  activeActorId?: string;
  onSelectVisualKey: (key: string) => void;
  onSelectActor: (actorId: string) => void;
  onPerformance: (sample: PerformanceSample) => void;
}

type BuildingKind = "leader" | "investment" | "finance" | "company" | "service";

interface DepartmentSpec {
  actorId: string;
  label: string;
  city: "chengdu" | "chongqing" | "center";
  kind: BuildingKind;
  position: THREE.Vector3Tuple;
  color: string;
}

/** 大地图布局：浅色路网 + 白色街区 + 地标建筑，参考城市导览图风格 */
const DEPARTMENTS: DepartmentSpec[] = [
  { actorId: "chengdu_investment", label: "招商促进局", city: "chengdu", kind: "investment", position: [-7.5, 0, -2.2], color: "#d9a83c" },
  { actorId: "chengdu_finance", label: "财政审查局", city: "chengdu", kind: "finance", position: [-7.3, 0, 1.2], color: "#6e9be8" },
  { actorId: "chengdu_leader", label: "城市决策中心", city: "chengdu", kind: "leader", position: [-7.4, 0, 4.6], color: "#4fbf98" },
  { actorId: "chongqing_leader", label: "城市决策中心", city: "chongqing", kind: "leader", position: [7.4, 0, -2.2], color: "#ef785d" },
  { actorId: "chongqing_finance", label: "财政审查局", city: "chongqing", kind: "finance", position: [7.3, 0, 1.2], color: "#9b83d5" },
  { actorId: "chongqing_investment", label: "招商促进局", city: "chongqing", kind: "investment", position: [7.4, 0, 4.6], color: "#55b7dc" },
  { actorId: "regional_coordinator", label: "成渝协调中心", city: "center", kind: "leader", position: [-2.5, 0, -2.4], color: "#9a7fd0" },
  { actorId: "policy_supervisor", label: "政策审计中心", city: "center", kind: "finance", position: [2.5, 0, -2.4], color: "#638bd5" },
  { actorId: "company_ceo", label: "CEO 战略室", city: "center", kind: "company", position: [-2.4, 0, 1.1], color: "#d9a83c" },
  { actorId: "company_board", label: "企业董事会", city: "center", kind: "company", position: [0, 0, 4.7], color: "#4fbf98" },
  { actorId: "company_cfo", label: "CFO 财务室", city: "center", kind: "company", position: [2.4, 0, 1.1], color: "#ef785d" },
  { actorId: "due_diligence_service", label: "尽调数据站", city: "center", kind: "service", position: [-2.5, 0, 5.9], color: "#8a99ad" },
  { actorId: "world_resource_service", label: "资源计算站", city: "center", kind: "service", position: [2.5, 0, 5.9], color: "#8a99ad" },
];

const STAKEHOLDERS = [
  { actorId: "investor", label: "投资机构", position: [-3.6, 0, 4.9] as THREE.Vector3Tuple, color: "#d9a83c" },
  { actorId: "talent_sme", label: "人才与中小企业", position: [3.6, 0, 4.9] as THREE.Vector3Tuple, color: "#50b58e" },
  { actorId: "resident", label: "居民代表", position: [0, 0, 1.4] as THREE.Vector3Tuple, color: "#e87973" },
];

const ACTOR_POSITIONS = new Map<string, THREE.Vector3Tuple>([
  ...DEPARTMENTS.map((department) => [department.actorId, department.position] as [string, THREE.Vector3Tuple]),
  ...STAKEHOLDERS.map((stakeholder) => [stakeholder.actorId, stakeholder.position] as [string, THREE.Vector3Tuple]),
]);

/** 路网：东西向街道 + 南北向大道，名称直接印在路面上 */
const STREETS = [
  { z: -4, name: "政 策 走 廊" },
  { z: -0.5, name: "政企联络大道" },
  { z: 3, name: "民生反馈街" },
  { z: 6.5, name: "履约核验街" },
];
const AVENUES = [
  { x: -10, name: "高 新 大 道" },
  { x: -5, name: "天府科创路" },
  { x: 0, name: "双城协同轴" },
  { x: 5, name: "两江智造路" },
  { x: 10, name: "渝 州 大 道" },
];
const MAP_X = 11.6;
const MAP_Z_MIN = -7.1;
const MAP_Z_MAX = 7.6;

const PARKS = [
  { x: -7.4, z: -5.6, w: 3.6, d: 2.2, name: "高新中央公园" },
  { x: 7.4, z: -5.6, w: 3.6, d: 2.2, name: "两江滨江公园" },
  { x: 0, z: -2.2, w: 3.4, d: 2.4, name: "协调公园" },
];

const PROJECT_CORE: THREE.Vector3Tuple = [0, 1.55, 4.7];

function PerformanceProbe({ onPerformance }: { onPerformance: (sample: PerformanceSample) => void }) {
  const { gl } = useThree();
  const frames = useRef(0);
  const startedAt = useRef(performance.now());
  useFrame(() => {
    frames.current += 1;
    const now = performance.now();
    const elapsed = now - startedAt.current;
    if (elapsed >= 800) {
      onPerformance({ fps: Math.round((frames.current * 1000) / elapsed), drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles });
      frames.current = 0;
      startedAt.current = now;
    }
  });
  return null;
}

/** 生成印在地面/路面上的文字贴图（canvas 纹理，原生支持中文） */
function useGroundText(text: string, options?: { color?: string; fontSize?: number; spacing?: number }) {
  const color = options?.color ?? "#9aa0a6";
  const fontSize = options?.fontSize ?? 56;
  const spacing = options?.spacing ?? fontSize * .3;
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    const probe = canvas.getContext("2d")!;
    const font = `650 ${fontSize}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
    probe.font = font;
    const chars = [...text];
    const width = Math.ceil(chars.reduce((sum, ch) => sum + probe.measureText(ch).width, 0) + spacing * Math.max(0, chars.length - 1)) + 10;
    canvas.width = Math.max(2, width);
    canvas.height = Math.ceil(fontSize * 1.7);
    const ctx = canvas.getContext("2d")!;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    let x = 5;
    for (const ch of chars) {
      ctx.fillText(ch, x, canvas.height / 2);
      x += ctx.measureText(ch).width + spacing;
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 8;
    texture.colorSpace = THREE.SRGBColorSpace;
    return { texture, aspect: canvas.width / canvas.height };
  }, [text, color, fontSize, spacing]);
}

function GroundText({ text, position, height, rotation = 0, color, fontSize, spacing }: {
  text: string;
  position: THREE.Vector3Tuple;
  height: number;
  rotation?: number;
  color?: string;
  fontSize?: number;
  spacing?: number;
}) {
  const { texture, aspect } = useGroundText(text, { color, fontSize, spacing });
  return <mesh position={position} rotation={[-Math.PI / 2, 0, rotation]} renderOrder={3}>
    <planeGeometry args={[height * aspect, height]} />
    <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
  </mesh>;
}

function StreetGrid() {
  return <group>
    {STREETS.map(({ z, name }) => <group key={z}>
      <mesh position={[0, .012, z]} receiveShadow><boxGeometry args={[MAP_X * 2, .024, 1]} /><meshStandardMaterial color="#f4f5f6" roughness={.95} /></mesh>
      <GroundText text={name} position={[0, .03, z]} height={.46} color="#a4a9af" />
    </group>)}
    {AVENUES.map(({ x, name }) => <group key={x}>
      <mesh position={[x, .012, (MAP_Z_MIN + MAP_Z_MAX) / 2]} receiveShadow><boxGeometry args={[1, .024, MAP_Z_MAX - MAP_Z_MIN]} /><meshStandardMaterial color="#f4f5f6" roughness={.95} /></mesh>
      <GroundText text={name} position={[x, .03, .3]} height={.46} rotation={Math.PI / 2} color="#a4a9af" />
    </group>)}
  </group>;
}

function River() {
  return <group>
    <mesh position={[0, .006, -9.4]} receiveShadow><boxGeometry args={[MAP_X * 2 + 8, .012, 3.4]} /><meshStandardMaterial color="#8fc3da" roughness={.35} metalness={.05} /></mesh>
    <mesh position={[0, .014, -7.55]} receiveShadow><boxGeometry args={[MAP_X * 2 + 8, .02, .5]} /><meshStandardMaterial color="#a9c8a2" roughness={.9} /></mesh>
    <GroundText text="府 南 河" position={[-6.4, .05, -9.4]} height={.62} color="#ffffff" spacing={30} />
    <GroundText text="嘉 陵 江" position={[6.4, .05, -9.4]} height={.62} color="#ffffff" spacing={30} />
  </group>;
}

function Tree({ position, scale = 1 }: { position: THREE.Vector3Tuple; scale?: number }) {
  return <group position={position} scale={scale}>
    <mesh position={[0, .09, 0]} castShadow><cylinderGeometry args={[.03, .045, .18, 6]} /><meshStandardMaterial color="#8a6f52" roughness={.9} /></mesh>
    <mesh position={[0, .34, 0]} castShadow><coneGeometry args={[.2, .42, 7]} /><meshStandardMaterial color="#5e9a6d" roughness={.8} /></mesh>
    <mesh position={[0, .55, 0]} castShadow><coneGeometry args={[.13, .3, 7]} /><meshStandardMaterial color="#6fae7c" roughness={.8} /></mesh>
  </group>;
}

function Park({ x, z, w, d, name }: { x: number; z: number; w: number; d: number; name: string }) {
  const trees = useMemo(() => Array.from({ length: 5 }, (_, index) => ({
    x: x - w / 2 + .5 + ((index * 97 + 31) % 100) / 100 * (w - 1),
    z: z - d / 2 + .4 + ((index * 53 + 17) % 100) / 100 * (d - .8),
    scale: .8 + ((index * 29) % 40) / 100,
  })), [x, z, w, d]);
  return <group>
    <RoundedBox args={[w, .05, d]} radius={.1} smoothness={2} position={[x, .025, z]} receiveShadow><meshStandardMaterial color="#b5d3ab" roughness={.95} /></RoundedBox>
    {trees.map((tree, index) => <Tree key={index} position={[tree.x, .05, tree.z]} scale={tree.scale} />)}
    <GroundText text={name} position={[x, .06, z]} height={.3} color="#5f8a58" fontSize={44} />
  </group>;
}

function DistrictLabels() {
  return <group>
    <GroundText text="成 都 高 新 区" position={[-7.4, .028, 6.9]} height={.66} color="#8fa89c" fontSize={60} spacing={34} />
    <GroundText text="重 庆 两 江 新 区" position={[7.4, .028, 6.9]} height={.66} color="#b09a90" fontSize={60} spacing={34} />
    <GroundText text="双 城 协 调 中 枢" position={[0, .028, -5.9]} height={.6} color="#9b95ad" fontSize={58} spacing={32} />
  </group>;
}

/** 街区内的白色环境建筑，确定性伪随机分布，避开地标与公园 */
function AmbientBlocks() {
  const blocks = useMemo(() => {
    const landmarks = [...DEPARTMENTS.map((d) => d.position), ...STAKEHOLDERS.map((s) => s.position)];
    const cellsX = [-7.5, -2.5, 2.5, 7.5];
    const cellsZ = [-2.25, 1.25, 4.75];
    const result: Array<{ x: number; z: number; w: number; d: number; h: number; tone: number }> = [];
    cellsX.forEach((cx, ix) => cellsZ.forEach((cz, iz) => {
      const count = 2 + ((ix * 3 + iz * 5) % 2);
      for (let k = 0; k < count; k += 1) {
        const seed = ix * 131 + iz * 57 + k * 23;
        const x = cx - 1.1 + ((seed * 37) % 100) / 100 * 2.2;
        const z = cz - .85 + ((seed * 61) % 100) / 100 * 1.7;
        if (landmarks.some(([lx, , lz]) => Math.hypot(lx - x, lz - z) < 1.35)) continue;
        if (PARKS.some((park) => Math.abs(park.x - x) < park.w / 2 + .3 && Math.abs(park.z - z) < park.d / 2 + .3)) continue;
        result.push({
          x, z,
          w: .55 + ((seed * 13) % 40) / 100,
          d: .5 + ((seed * 17) % 35) / 100,
          h: .35 + ((seed * 7) % 100) / 100 * .85,
          tone: (seed * 11) % 3,
        });
      }
    }));
    return result;
  }, []);
  const tones = ["#f2f3f4", "#e9ebec", "#f6f4ef"];
  return <>{blocks.map((block, index) => <mesh key={index} position={[block.x, block.h / 2 + .02, block.z]} castShadow receiveShadow><boxGeometry args={[block.w, block.h, block.d]} /><meshStandardMaterial color={tones[block.tone]} roughness={.85} /></mesh>)}</>;
}

function GlassBands({ width, height, depth, y }: { width: number; height: number; depth: number; y: number }) {
  const bands = Math.max(2, Math.floor(height / .42));
  return <>{Array.from({ length: bands }, (_, index) => {
    const bandY = y - height / 2 + .3 + index * ((height - .5) / Math.max(1, bands - 1));
    return <mesh key={index} position={[0, bandY, depth / 2 + .008]}><boxGeometry args={[width * .72, .09, .016]} /><meshStandardMaterial color="#c3ced4" roughness={.25} metalness={.2} /></mesh>;
  })}</>;
}

/** 地标建筑：白色体量 + 部门色檐口，保持极简导览图风格 */
function LandmarkGeometry({ kind, color }: { kind: BuildingKind; color: string }) {
  if (kind === "leader") return <>
    <mesh position={[0, 1.1, 0]} castShadow><boxGeometry args={[.95, 2.2, .95]} /><meshStandardMaterial color="#f5f3ed" roughness={.62} /></mesh>
    <GlassBands width={.95} height={2.2} depth={.95} y={1.1} />
    <mesh position={[0, 2.26, 0]} castShadow><boxGeometry args={[.78, .14, .78]} /><meshStandardMaterial color={color} roughness={.45} /></mesh>
    <mesh position={[0, 2.5, 0]} castShadow><cylinderGeometry args={[.02, .06, .36, 6]} /><meshStandardMaterial color="#b8b2a4" roughness={.5} /></mesh>
  </>;
  if (kind === "investment") return <>
    <mesh position={[-.3, .85, 0]} castShadow><boxGeometry args={[.72, 1.7, .8]} /><meshStandardMaterial color="#f5f3ed" roughness={.62} /></mesh>
    <GlassBands width={.72} height={1.7} depth={.8} y={.85} />
    <mesh position={[-.3, 1.76, 0]} castShadow><boxGeometry args={[.6, .12, .68]} /><meshStandardMaterial color={color} roughness={.45} /></mesh>
    <mesh position={[.42, .5, .06]} castShadow><boxGeometry args={[.6, 1, .7]} /><meshStandardMaterial color="#eceae3" roughness={.7} /></mesh>
    <mesh position={[.42, 1.04, .06]} castShadow><boxGeometry args={[.5, .09, .6]} /><meshStandardMaterial color="#d9c98f" roughness={.5} /></mesh>
  </>;
  if (kind === "finance") return <>
    <mesh position={[0, .55, 0]} castShadow><boxGeometry args={[1.35, 1.1, .95]} /><meshStandardMaterial color="#f5f3ed" roughness={.64} /></mesh>
    <GlassBands width={1.35} height={1.1} depth={.95} y={.55} />
    <mesh position={[0, 1.14, 0]} castShadow><boxGeometry args={[1.42, .12, 1.02]} /><meshStandardMaterial color={color} roughness={.45} /></mesh>
  </>;
  if (kind === "company") return <>
    <mesh position={[0, .72, 0]} castShadow><boxGeometry args={[.85, 1.44, .8]} /><meshStandardMaterial color="#f5f3ed" roughness={.62} /></mesh>
    <GlassBands width={.85} height={1.44} depth={.8} y={.72} />
    <mesh position={[0, 1.5, 0]} castShadow><boxGeometry args={[.68, .12, .64]} /><meshStandardMaterial color={color} roughness={.45} /></mesh>
    <mesh position={[0, .5, .42]}><boxGeometry args={[.5, .3, .04]} /><meshStandardMaterial color="#aeb9c0" roughness={.3} metalness={.25} /></mesh>
  </>;
  return <>
    <mesh position={[0, .4, 0]} castShadow><boxGeometry args={[.95, .8, .8]} /><meshStandardMaterial color="#eef0f1" roughness={.7} /></mesh>
    <mesh position={[0, .84, 0]} castShadow><boxGeometry args={[1, .1, .86]} /><meshStandardMaterial color={color} roughness={.5} /></mesh>
    <mesh position={[0, 1.06, 0]}><cylinderGeometry args={[.015, .04, .34, 6]} /><meshStandardMaterial color="#9aa5ae" /></mesh>
  </>;
}

function DepartmentBuilding({ spec, active, onSelect }: { spec: DepartmentSpec; active: boolean; onSelect: () => void }) {
  const animated = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, delta) => {
    if (!animated.current) return;
    const targetScale = active ? 1.12 : 1;
    const targetY = active ? .16 + Math.sin(clock.elapsedTime * 5) * .035 : 0;
    animated.current.scale.setScalar(THREE.MathUtils.damp(animated.current.scale.x, targetScale, 6, delta));
    animated.current.position.y = THREE.MathUtils.damp(animated.current.position.y, targetY, 7, delta);
    if (beacon.current) beacon.current.rotation.z = clock.elapsedTime * 1.8;
  });
  const click = (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); };
  const labelHeight = spec.kind === "leader" ? 2.9 : spec.kind === "investment" ? 2.2 : spec.kind === "company" ? 1.9 : spec.kind === "finance" ? 1.6 : 1.35;
  return <group position={spec.position} onClick={click}>
    <group ref={animated}>
      <LandmarkGeometry kind={spec.kind} color={spec.color} />
      {active && <>
        <mesh position={[0, .03, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[.85, .97, 44]} /><meshBasicMaterial color={spec.color} transparent opacity={.9} depthWrite={false} /></mesh>
        <mesh ref={beacon} position={[0, labelHeight - .35, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.28, .04, 8, 32]} /><meshBasicMaterial color={spec.color} toneMapped={false} /></mesh>
      </>}
    </group>
    <Html position={[0, labelHeight, 0]} center distanceFactor={14} zIndexRange={[10, 0]}>
      <button type="button" className={`department-label-3d ${active ? "active" : ""} ${spec.city}`} tabIndex={-1}><small>{spec.city === "chengdu" ? "成都" : spec.city === "chongqing" ? "重庆" : spec.kind === "service" ? "规则服务" : "中枢"}</small><strong>{spec.label}</strong></button>
    </Html>
  </group>;
}

function StakeholderNode({ actorId, label, position, color, active, onSelect }: { actorId: string; label: string; position: THREE.Vector3Tuple; color: string; active: boolean; onSelect: (actorId: string) => void }) {
  const node = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (node.current) node.current.scale.setScalar(active ? 1.05 + Math.sin(clock.elapsedTime * 5) * .12 : 1); });
  return <group ref={node} position={position} onClick={(event) => { event.stopPropagation(); onSelect(actorId); }}>
    <mesh position={[0, .02, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[.34, 28]} /><meshBasicMaterial color={color} transparent opacity={.22} depthWrite={false} /></mesh>
    <mesh position={[0, .18, 0]} castShadow><sphereGeometry args={[.17, 16, 16]} /><meshStandardMaterial color={color} emissive={active ? color : "#000000"} emissiveIntensity={active ? .6 : 0} roughness={.4} /></mesh>
    <Html position={[0, .5, 0]} center distanceFactor={15}><button type="button" className={`stakeholder-label-3d ${active ? "active" : ""}`} tabIndex={-1}>{label}</button></Html>
  </group>;
}

function ActiveFlow({ actorId }: { actorId?: string }) {
  const from = actorId ? ACTOR_POSITIONS.get(actorId) : undefined;
  const curve = useMemo(() => {
    if (!from) return null;
    const start = new THREE.Vector3(from[0], from[1] + 1.1, from[2]);
    const end = new THREE.Vector3(...PROJECT_CORE);
    const mid = start.clone().lerp(end, .5);
    mid.y += 1 + Math.abs(start.x) * .06;
    return new THREE.QuadraticBezierCurve3(start, mid, end);
  }, [from]);
  const point = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (point.current && curve) point.current.position.copy(curve.getPoint((clock.elapsedTime * .28) % 1)); });
  if (!curve) return null;
  const color = actorId?.startsWith("chengdu") ? "#36a77f" : actorId?.startsWith("chongqing") ? "#e96f54" : "#8a70c6";
  return <group>
    <mesh><tubeGeometry args={[curve, 48, .03, 7, false]} /><meshBasicMaterial color={color} transparent opacity={.78} depthWrite={false} /></mesh>
    <mesh ref={point}><sphereGeometry args={[.1, 10, 10]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>
  </group>;
}

function ProjectBeacon({ tendency, selected, onSelect }: { tendency?: SemanticEffects["projectTendency"]; selected: boolean; onSelect: () => void }) {
  const beacon = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (beacon.current) beacon.current.rotation.y = clock.elapsedTime * .32; });
  const x = tendency === "chengdu_research" ? -1.1 : tendency === "chongqing_manufacturing" ? 1.1 : 0;
  const y = tendency === "exit_risk" ? .6 : PROJECT_CORE[1];
  return <group ref={beacon} position={[x, y, PROJECT_CORE[2]]} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
    <mesh castShadow><octahedronGeometry args={[.32]} /><meshStandardMaterial color={tendency === "exit_risk" ? "#a89f97" : "#d9a83c"} emissive={selected ? "#d9a83c" : "#000000"} emissiveIntensity={selected ? .4 : 0} roughness={.35} metalness={.15} /></mesh>
    <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.62, .028, 8, 48]} /><meshBasicMaterial color="#8b9096" transparent opacity={.45} /></mesh>
  </group>;
}

function DirectedOrbitControls({ activeActorId }: { activeActorId?: string }) {
  const { camera } = useThree();
  const controls = useRef<any>(null);
  const desired = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | undefined>(undefined);
  useEffect(() => {
    const actor = activeActorId ? ACTOR_POSITIONS.get(activeActorId) : undefined;
    if (!actor) return;
    const target = new THREE.Vector3(actor[0], .45, actor[2]);
    desired.current = { target, position: target.clone().add(new THREE.Vector3(0, 12.8, 18.2)) };
  }, [activeActorId]);
  useFrame((_, delta) => {
    const next = desired.current;
    const control = controls.current;
    if (!next || !control) return;
    const amount = 1 - Math.exp(-delta * 5.2);
    control.target.lerp(next.target, amount);
    camera.position.lerp(next.position, amount);
    control.update();
    if (control.target.distanceTo(next.target) < .025 && camera.position.distanceTo(next.position) < .04) desired.current = undefined;
  });
  return <OrbitControls ref={controls} makeDefault enablePan minDistance={13} maxDistance={30} minPolarAngle={.68} maxPolarAngle={1.16} target={[0, 0, .9]} onStart={() => { desired.current = undefined; }} />;
}

function Scene(props: CitySandboxProps) {
  return <>
    <color attach="background" args={["#d3d5d8"]} />
    <fog attach="fog" args={["#d3d5d8", 30, 52]} />
    <hemisphereLight intensity={1.55} color="#ffffff" groundColor="#b4b8bb" />
    <ambientLight intensity={.75} />
    <directionalLight position={[-11, 17, 9]} intensity={2.3} color="#fffdf6" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-17} shadow-camera-right={17} shadow-camera-top={15} shadow-camera-bottom={-15} />
    <directionalLight position={[10, 8, -6]} intensity={.7} color="#dfe9f5" />
    <mesh position={[0, -.08, 0]} receiveShadow><boxGeometry args={[70, .16, 60]} /><meshStandardMaterial color="#d3d5d8" roughness={1} /></mesh>
    <River />
    <StreetGrid />
    <DistrictLabels />
    {PARKS.map((park) => <Park key={park.name} {...park} />)}
    <AmbientBlocks />
    {DEPARTMENTS.map((department) => <DepartmentBuilding key={department.actorId} spec={department} active={props.activeActorId === department.actorId} onSelect={() => props.onSelectActor(department.actorId)} />)}
    {STAKEHOLDERS.map((stakeholder) => <StakeholderNode key={stakeholder.actorId} {...stakeholder} active={props.activeActorId === stakeholder.actorId} onSelect={props.onSelectActor} />)}
    <ProjectBeacon tendency={props.semanticEffects?.projectTendency} selected={props.selectedVisualKey === "visual-project-core"} onSelect={() => props.onSelectVisualKey("visual-project-core")} />
    <ActiveFlow actorId={props.activeActorId} />
    <PerformanceProbe onPerformance={props.onPerformance} />
    <DirectedOrbitControls activeActorId={props.activeActorId} />
  </>;
}

export function CitySandbox(props: CitySandboxProps) {
  return <Canvas className="city-canvas" camera={{ position: [0, 15.5, 21.5], fov: 39, near: .1, far: 90 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }} shadows onPointerMissed={() => props.onSelectVisualKey("visual-project-core")}><Scene {...props} /></Canvas>;
}
