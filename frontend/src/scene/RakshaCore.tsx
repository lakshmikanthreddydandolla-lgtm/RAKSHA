import { Html } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

export type ThemeMode = 'aurora' | 'archive'
export type MotionMode = 'lite' | 'full'
export type SecurityState = 'normal' | 'review' | 'block' | 'verified' | 'offline'
export type WorkflowId = 'command' | 'redteam' | 'governance' | 'evidence' | 'policies'

const workflows: { id: WorkflowId; label: string }[] = [
  { id: 'command', label: 'COMMAND CENTER' },
  { id: 'redteam', label: 'RED-TEAM LAB' },
  { id: 'governance', label: 'HUMAN GOVERNANCE' },
  { id: 'evidence', label: 'EVIDENCE CENTER' },
  { id: 'policies', label: 'POLICIES' },
]

function makeLabelTexture(text: string, theme: ThemeMode) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 180
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.font = '700 66px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = theme === 'archive' ? '#f0ede4' : '#2b2926'
  ctx.shadowColor = theme === 'archive' ? '#ffffff' : '#d8b98b'
  ctx.shadowBlur = 14
  ctx.fillText(text.toUpperCase(), 256, 92)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function Brain({
  label,
  theme,
  motion,
  security,
  intro,
  onClick,
}: {
  label: string
  theme: ThemeMode
  motion: MotionMode
  security: SecurityState
  intro?: boolean
  onClick?: () => void
}) {
  const root = useRef<THREE.Group>(null)
  const inner = useRef<THREE.Mesh>(null)
  const introProgress = useRef(intro ? 0 : 1)
  const texture = useMemo(() => makeLabelTexture(label, theme), [label, theme])

  const metal = theme === 'archive' ? '#787878' : '#c7b08c'
  const core = security === 'offline'
    ? '#353535'
    : security === 'block'
      ? '#6f1116'
      : security === 'review'
        ? '#ad721c'
        : theme === 'archive'
          ? '#e8e5dc'
          : '#d6ad78'

  useFrame((state, delta) => {
    if (!root.current || !inner.current) return
    introProgress.current = Math.min(1, introProgress.current + delta * 0.85)
    const introEase = 1 - Math.pow(1 - introProgress.current, 3)
    const breath = security === 'offline' ? 1 : 1 + Math.sin(state.clock.elapsedTime * 1.25) * 0.018
    root.current.scale.setScalar(introEase * breath)
    const pulse = security === 'review' ? 1.14 : security === 'block' ? 1.2 : 1.03
    inner.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 1.7) * 0.025 * pulse)
  })

  const lobeGeometry = motion === 'full' ? [2, 2] : [1, 1] as const

  return (
    <group ref={root} onClick={(event) => { event.stopPropagation(); onClick?.() }}>
      <mesh ref={inner}>
        <icosahedronGeometry args={[0.78, motion === 'full' ? 4 : 2]} />
        <meshStandardMaterial
          color={core}
          emissive={core}
          emissiveIntensity={security === 'offline' ? 0.02 : 0.24}
          roughness={0.52}
          metalness={0.18}
        />
      </mesh>

      {[-0.47, 0.47].map((x, index) => (
        <mesh key={index} position={[x, 0, 0.03]} scale={[0.82, 1, 0.82]}>
          <icosahedronGeometry args={[0.79, ...lobeGeometry]} />
          <meshPhysicalMaterial
            color={metal}
            wireframe
            transparent
            opacity={security === 'offline' ? 0.25 : 0.64}
            roughness={0.28}
            metalness={0.9}
          />
        </mesh>
      ))}

      <mesh position={[0, 0, 0.83]}>
        <planeGeometry args={[1.35, 0.48]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} />
      </mesh>
    </group>
  )
}

function Shield({ theme, motion, security }: { theme: ThemeMode; motion: MotionMode; security: SecurityState }) {
  const ringA = useRef<THREE.Mesh>(null)
  const ringB = useRef<THREE.Mesh>(null)
  const particles = useRef<THREE.Points>(null)
  const count = motion === 'full' ? 900 : 260
  const positions = useMemo(() => {
    const values = new Float32Array(count * 3)
    for (let i = 0; i < count; i += 1) {
      const phi = Math.acos(1 - 2 * (i + 0.5) / count)
      const theta = Math.PI * (1 + Math.sqrt(5)) * i
      const radius = 1.64 + ((i % 9) - 4) * 0.006
      values[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      values[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta)
      values[i * 3 + 2] = radius * Math.cos(phi)
    }
    return values
  }, [count])

  const accent = security === 'block'
    ? '#c53b45'
    : security === 'review'
      ? '#c89338'
      : security === 'verified'
        ? '#8eaa8d'
        : theme === 'archive'
          ? '#d8d5cd'
          : '#b99a70'

  useFrame((state, delta) => {
    if (ringA.current) ringA.current.rotation.z += delta * (security === 'block' ? 0.75 : 0.12)
    if (ringB.current) ringB.current.rotation.x -= delta * (security === 'block' ? 0.52 : 0.08)
    if (particles.current) particles.current.rotation.y += delta * (motion === 'full' ? 0.035 : 0.018)
    if (security === 'verified' && ringA.current && ringB.current) {
      const sync = Math.sin(state.clock.elapsedTime * 3) * 0.04
      ringA.current.rotation.y = sync
      ringB.current.rotation.y = sync
    }
  })

  return (
    <group>
      <mesh ref={ringA} rotation={[Math.PI / 2, 0.28, 0]}>
        <torusGeometry args={[1.36, 0.014, 8, motion === 'full' ? 144 : 72]} />
        <meshBasicMaterial color={accent} transparent opacity={0.82} />
      </mesh>
      <mesh ref={ringB} rotation={[0.55, 0, Math.PI / 2]}>
        <torusGeometry args={[1.52, 0.009, 8, motion === 'full' ? 128 : 64]} />
        <meshBasicMaterial color={accent} transparent opacity={0.48} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.72, motion === 'full' ? 64 : 28, motion === 'full' ? 64 : 28]} />
        <meshPhysicalMaterial
          color={accent}
          transparent
          opacity={security === 'block' ? 0.12 : 0.045}
          roughness={0.08}
          metalness={0.05}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <points ref={particles}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial color={accent} size={motion === 'full' ? 0.025 : 0.018} transparent opacity={0.76} sizeAttenuation />
      </points>
    </group>
  )
}

function OrbitalPlaques({
  theme,
  motion,
  visible,
  manualRotation,
  dragging,
  onSelect,
}: {
  theme: ThemeMode
  motion: MotionMode
  visible: boolean
  manualRotation: number
  dragging: boolean
  onSelect?: (id: WorkflowId) => void
}) {
  const orbit = useRef<THREE.Group>(null)
  const auto = useRef(0)

  useFrame((_, delta) => {
    if (!orbit.current) return
    if (!dragging && visible) auto.current += delta * (motion === 'full' ? 0.18 : 0.12)
    orbit.current.rotation.y = auto.current + manualRotation
    orbit.current.scale.lerp(new THREE.Vector3(visible ? 1 : 0.001, visible ? 1 : 0.001, visible ? 1 : 0.001), 0.12)
  })

  return (
    <group ref={orbit} visible={visible}>
      {workflows.map((workflow, index) => {
        const angle = index / workflows.length * Math.PI * 2
        const x = Math.cos(angle) * 3.45
        const z = Math.sin(angle) * 1.58
        const y = Math.sin(angle * 2) * 0.42
        return (
          <group key={workflow.id} position={[x, y, z]}>
            <mesh onClick={(event) => { event.stopPropagation(); onSelect?.(workflow.id) }}>
              <boxGeometry args={[1.68, 0.52, 0.08]} />
              <meshStandardMaterial
                color={theme === 'archive' ? '#202020' : '#d9c6a5'}
                metalness={0.88}
                roughness={0.28}
              />
            </mesh>
            <Html center distanceFactor={8} zIndexRange={[20, 10]}>
              <button
                type="button"
                className="orbit-plaque-button"
                onClick={() => onSelect?.(workflow.id)}
              >
                {workflow.label}
              </button>
            </Html>
          </group>
        )
      })}
    </group>
  )
}

export function RakshaCore({
  theme,
  motion,
  label = 'RAKSHA',
  security = 'normal',
  intro = false,
  showPlaques = false,
  manualRotation = 0,
  dragging = false,
  onBrainClick,
  onWorkflow,
  compact = false,
}: {
  theme: ThemeMode
  motion: MotionMode
  label?: string
  security?: SecurityState
  intro?: boolean
  showPlaques?: boolean
  manualRotation?: number
  dragging?: boolean
  onBrainClick?: () => void
  onWorkflow?: (id: WorkflowId) => void
  compact?: boolean
}) {
  return (
    <Canvas
      className="raksha-canvas"
      dpr={motion === 'full' ? [1, 1.35] : [0.75, 1]}
      camera={{ position: [0, 0, compact ? 6.3 : 7.4], fov: compact ? 39 : 43 }}
      gl={{ antialias: motion === 'full', alpha: true, powerPreference: 'high-performance' }}
    >
      <ambientLight intensity={theme === 'archive' ? 1.4 : 1.7} />
      <directionalLight position={[4, 5, 6]} intensity={theme === 'archive' ? 1.4 : 2.3} />
      <pointLight position={[-4, -2, 3]} intensity={theme === 'archive' ? 0.5 : 1.2} />
      <group scale={compact ? 0.78 : 1}>
        <Brain label={label} theme={theme} motion={motion} security={security} intro={intro} onClick={onBrainClick} />
        <Shield theme={theme} motion={motion} security={security} />
      </group>
      {!compact && (
        <OrbitalPlaques
          theme={theme}
          motion={motion}
          visible={showPlaques}
          manualRotation={manualRotation}
          dragging={dragging}
          onSelect={onWorkflow}
        />
      )}
    </Canvas>
  )
}
