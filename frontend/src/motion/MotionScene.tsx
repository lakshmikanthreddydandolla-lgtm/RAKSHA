import { Float, Line, Stars } from "@react-three/drei"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import * as THREE from "three"

type EnvironmentName = "command" | "redteam" | "governance" | "evidence"
type Verdict = "ALLOW" | "REVIEW" | "BLOCK" | null

type Props = {
  environment: EnvironmentName
  verdict: Verdict
  reducedMotion: boolean
  activeAttackSteps?: number
}

const cameraTargets: Record<EnvironmentName, THREE.Vector3> = {
  command: new THREE.Vector3(0, 0.2, 8.2),
  redteam: new THREE.Vector3(3.9, 1.1, 7.4),
  governance: new THREE.Vector3(-3.8, 0.7, 7.2),
  evidence: new THREE.Vector3(0, 3.2, 7.8),
}

const lookTargets: Record<EnvironmentName, THREE.Vector3> = {
  command: new THREE.Vector3(0, 0, 0),
  redteam: new THREE.Vector3(1.0, 0.2, -0.8),
  governance: new THREE.Vector3(-1.1, 0.1, -0.6),
  evidence: new THREE.Vector3(0, 0.7, -1.2),
}

function Kernel({ verdict }: { verdict: Verdict }) {
  const group = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const core = useRef<THREE.Mesh>(null)
  const tone = verdict === "BLOCK" ? "#e66252" : verdict === "REVIEW" ? "#e9ad4c" : verdict === "ALLOW" ? "#70a987" : "#c98d68"

  useFrame((state, delta) => {
    if (group.current) {
      group.current.rotation.y += delta * 0.16
      group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, state.pointer.y * 0.11, 4, delta)
      group.current.rotation.z = THREE.MathUtils.damp(group.current.rotation.z, -state.pointer.x * 0.08, 4, delta)
    }
    if (ring.current) ring.current.rotation.z -= delta * 0.24
    if (core.current) {
      const target = verdict === "BLOCK" ? 1.14 : verdict === "REVIEW" ? 1.07 : 1
      core.current.scale.setScalar(THREE.MathUtils.damp(core.current.scale.x, target, 6, delta))
    }
  })

  return (
    <group ref={group}>
      <Float speed={1.3} rotationIntensity={0.18} floatIntensity={0.23}>
        <mesh ref={core}>
          <icosahedronGeometry args={[0.72, 2]} />
          <meshPhysicalMaterial color="#38271f" roughness={0.22} metalness={0.7} clearcoat={0.72} emissive={tone} emissiveIntensity={0.12} />
        </mesh>
      </Float>
      <mesh ref={ring} rotation={[Math.PI / 2.7, 0, 0]}>
        <torusGeometry args={[1.35, 0.035, 12, 100]} />
        <meshStandardMaterial color={tone} emissive={tone} emissiveIntensity={1.6} />
      </mesh>
      <mesh rotation={[Math.PI / 2.1, 0.5, 0.2]}>
        <torusGeometry args={[1.68, 0.012, 8, 100]} />
        <meshBasicMaterial color="#e4c6ad" transparent opacity={0.42} />
      </mesh>
      <pointLight color={tone} intensity={5.5} distance={8} decay={2} />
    </group>
  )
}

function CommandWorld({ verdict }: { verdict: Verdict }) {
  const gateY = verdict === "REVIEW" ? 0 : verdict === "BLOCK" ? -0.12 : 1.8
  const lineColor = verdict === "BLOCK" ? "#dc5b4f" : verdict === "REVIEW" ? "#e2a944" : "#6e9e7f"
  return (
    <group>
      <Kernel verdict={verdict} />
      <Line points={[[-4.3, 0, 0], [-1.75, 0, 0]]} color="#c5aa95" lineWidth={1.2} transparent opacity={0.65} />
      <Line points={[[1.75, 0, 0], [4.3, 0, 0]]} color={lineColor} lineWidth={1.8} transparent opacity={0.8} />
      {[-4.3, 4.3].map((x, index) => (
        <Float key={x} speed={1 + index * 0.2} floatIntensity={0.17}>
          <mesh position={[x, 0, 0]}>
            <octahedronGeometry args={[0.5, 0]} />
            <meshStandardMaterial color={index === 0 ? "#685043" : "#81675a"} roughness={0.42} metalness={0.38} />
          </mesh>
        </Float>
      ))}
      <group position={[2.45, gateY, 0]}>
        <mesh position={[0, 0.75, 0]}>
          <boxGeometry args={[0.08, 1.25, 1.8]} />
          <meshStandardMaterial color={verdict === "BLOCK" ? "#d95349" : "#d69a42"} emissive={verdict === "BLOCK" ? "#d95349" : "#d69a42"} emissiveIntensity={0.45} transparent opacity={0.72} />
        </mesh>
        <mesh position={[0, -0.75, 0]}>
          <boxGeometry args={[0.08, 1.25, 1.8]} />
          <meshStandardMaterial color={verdict === "BLOCK" ? "#d95349" : "#d69a42"} emissive={verdict === "BLOCK" ? "#d95349" : "#d69a42"} emissiveIntensity={0.45} transparent opacity={0.72} />
        </mesh>
      </group>
    </group>
  )
}

function RedTeamWorld({ activeAttackSteps = 4 }: { activeAttackSteps?: number }) {
  const group = useRef<THREE.Group>(null)
  const points = useMemo(() => [
    new THREE.Vector3(-3.4, 1.0, 0.4),
    new THREE.Vector3(-1.8, 0.3, -0.2),
    new THREE.Vector3(-0.2, 0.9, -0.9),
    new THREE.Vector3(1.4, -0.1, -1.15),
    new THREE.Vector3(3.1, 0.55, -0.6),
  ], [])
  useFrame((state, delta) => {
    if (!group.current) return
    group.current.rotation.y = THREE.MathUtils.damp(group.current.rotation.y, state.pointer.x * 0.12, 4, delta)
    group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, -state.pointer.y * 0.08, 4, delta)
  })
  return (
    <group ref={group} position={[0.65, 0, -0.5]}>
      <Line points={points} color="#c26a52" lineWidth={2.1} transparent opacity={0.7} />
      {points.map((point, index) => {
        const active = index < Math.max(1, activeAttackSteps)
        const final = index === Math.min(points.length - 1, Math.max(1, activeAttackSteps) - 1)
        return (
          <Float key={index} speed={1.1 + index * 0.13} floatIntensity={0.16}>
            <mesh position={point} scale={final ? 1.35 : 1}>
              <dodecahedronGeometry args={[0.34, 0]} />
              <meshStandardMaterial color={active ? (final ? "#df594e" : "#a95f4e") : "#4d3b34"} emissive={active ? "#d86d55" : "#000000"} emissiveIntensity={final ? 1.3 : 0.28} roughness={0.35} metalness={0.5} />
            </mesh>
          </Float>
        )
      })}
      <mesh position={[3.55, 0.55, -0.6]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.12, 2.0, 2.0]} />
        <meshStandardMaterial color="#e55d50" emissive="#e55d50" emissiveIntensity={0.7} transparent opacity={0.62} />
      </mesh>
    </group>
  )
}

function GovernanceWorld({ verdict }: { verdict: Verdict }) {
  const group = useRef<THREE.Group>(null)
  useFrame((state, delta) => {
    if (!group.current) return
    group.current.rotation.y = THREE.MathUtils.damp(group.current.rotation.y, state.pointer.x * 0.1, 5, delta)
  })
  const color = verdict === "BLOCK" ? "#d95e50" : "#d4a059"
  return (
    <group ref={group} position={[-0.8, 0, -0.5]}>
      <Kernel verdict={verdict === "ALLOW" ? "REVIEW" : verdict} />
      <mesh position={[-2.0, 0, 0]}>
        <boxGeometry args={[0.18, 3.4, 2.8]} />
        <meshStandardMaterial color="#3d2d27" roughness={0.28} metalness={0.55} />
      </mesh>
      <mesh position={[2.0, 0, 0]}>
        <boxGeometry args={[0.18, 3.4, 2.8]} />
        <meshStandardMaterial color="#3d2d27" roughness={0.28} metalness={0.55} />
      </mesh>
      <mesh position={[0, 0, -0.2]}>
        <boxGeometry args={[3.85, 0.055, 2.5]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.42} transparent opacity={0.3} />
      </mesh>
    </group>
  )
}

function EvidenceWorld() {
  const group = useRef<THREE.Group>(null)
  useFrame((state, delta) => {
    if (!group.current) return
    group.current.rotation.y += delta * 0.055
    group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, state.pointer.y * 0.08, 4, delta)
  })
  const positions = [-3.0, -1.5, 0, 1.5, 3.0]
  return (
    <group ref={group} position={[0, 0.35, -1.0]}>
      <Line points={positions.map((x, i) => [x, Math.sin(i * 0.8) * 0.32, 0] as [number, number, number])} color="#83a796" lineWidth={1.4} transparent opacity={0.7} />
      {positions.map((x, index) => (
        <Float key={x} speed={0.8 + index * 0.08} floatIntensity={0.12}>
          <mesh position={[x, Math.sin(index * 0.8) * 0.32, 0]} rotation={[Math.PI / 2, index * 0.55, 0]}>
            <torusGeometry args={[0.48, 0.08, 12, 48]} />
            <meshStandardMaterial color={index === 4 ? "#8db39e" : "#765b4d"} emissive={index === 4 ? "#7dad93" : "#000000"} emissiveIntensity={0.5} roughness={0.32} metalness={0.55} />
          </mesh>
        </Float>
      ))}
    </group>
  )
}

function World({ environment, verdict, reducedMotion, activeAttackSteps }: Props) {
  const { camera } = useThree()
  const look = useRef(new THREE.Vector3())
  useFrame((_, delta) => {
    const speed = reducedMotion ? 9 : 3.6
    camera.position.x = THREE.MathUtils.damp(camera.position.x, cameraTargets[environment].x, speed, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, cameraTargets[environment].y, speed, delta)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, cameraTargets[environment].z, speed, delta)
    look.current.lerp(lookTargets[environment], 1 - Math.exp(-delta * speed))
    camera.lookAt(look.current)
  })

  return (
    <>
      <ambientLight intensity={0.48} />
      <directionalLight position={[5, 6, 5]} intensity={1.25} color="#f3d7c2" />
      <pointLight position={[-5, 2, 3]} intensity={2.0} color="#81604d" distance={14} />
      <Stars radius={28} depth={18} count={reducedMotion ? 260 : 720} factor={1.3} saturation={0.3} fade speed={0.18} />
      {environment === "command" && <CommandWorld verdict={verdict} />}
      {environment === "redteam" && <RedTeamWorld activeAttackSteps={activeAttackSteps} />}
      {environment === "governance" && <GovernanceWorld verdict={verdict} />}
      {environment === "evidence" && <EvidenceWorld />}
    </>
  )
}

export default function MotionScene(props: Props) {
  return (
    <div className="motion-scene" aria-hidden="true">
      <Canvas
        dpr={[1, 1.25]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ position: cameraTargets.command.toArray() as [number, number, number], fov: 42, near: 0.1, far: 60 }}
      >
        <color attach="background" args={["#160f0c"]} />
        <fog attach="fog" args={["#160f0c", 9, 24]} />
        <World {...props} />
      </Canvas>
    </div>
  )
}
