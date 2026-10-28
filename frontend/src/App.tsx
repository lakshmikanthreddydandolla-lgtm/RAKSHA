import { useMemo, useRef, useState } from 'react'
import './App.css'
import {
  RakshaCore,
  type MotionMode,
  type ThemeMode,
  type WorkflowId,
} from './scene/RakshaCore'
import {
  CommandCenter,
  EvidenceCenter,
  HumanGovernance,
  Policies,
  ProviderSelection,
  RedTeamLab,
} from './workflows/Workflows'
import type { ProviderMode } from './api'

type Phase = 'landing' | 'activating' | 'hub' | 'workflow'

const workflowNames: Record<WorkflowId, string> = {
  command: 'COMMAND CENTER',
  redteam: 'RED-TEAM LAB',
  governance: 'HUMAN GOVERNANCE',
  evidence: 'EVIDENCE CENTER',
  policies: 'POLICIES',
}

function readTheme(): ThemeMode {
  const saved = window.localStorage.getItem('raksha-theme')
  return saved === 'archive' ? 'archive' : 'aurora'
}

function readMotion(): MotionMode {
  const saved = window.localStorage.getItem('raksha-motion')
  return saved === 'full' ? 'full' : 'lite'
}

function GlobalControls({
  active,
  theme,
  motion,
  onTheme,
  onMotion,
  onHome,
}: {
  active: boolean
  theme: ThemeMode
  motion: MotionMode
  onTheme: () => void
  onMotion: () => void
  onHome?: () => void
}) {
  return (
    <div className={`global-controls ${active ? 'active' : 'landing-controls'}`}>
      {onHome && <button type="button" className="global-circle" title="Core Hub" onClick={onHome}><span>⌂</span><small>HOME</small></button>}
      <button type="button" className="global-circle" title="Switch theme" onClick={onTheme}><span>{theme === 'aurora' ? '◐' : '◑'}</span><small>{theme === 'aurora' ? 'AURORA' : 'ARCHIVE'}</small></button>
      {active && <button type="button" className="global-circle" title="Switch motion mode" onClick={onMotion}><span>{motion === 'lite' ? 'L' : 'F'}</span><small>{motion.toUpperCase()}</small></button>}
    </div>
  )
}

function LoadingSeal({ text }: { text: string }) {
  return (
    <div className="loading-seal" aria-live="polite">
      <div className="loading-rings"><i /><i /><b /></div>
      <span>{text}</span>
    </div>
  )
}

function Landing({ phase, onActivate }: { phase: Phase; onActivate: () => void }) {
  const particles = useMemo(() => Array.from({ length: 72 }, (_, index) => {
    const angle = index / 72 * Math.PI * 2
    const radius = 90 + (index % 11) * 12
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * 0.52,
      delay: (index % 12) * 0.018,
    }
  }), [])

  return (
    <div className={`landing ${phase === 'activating' ? 'disintegrating' : ''}`}>
      <div className="cover-frame" />
      <div className="cover-content">
        <p className="cover-kicker">RUNTIME AGENT SECURITY</p>
        <h1>RAKSHA</h1>
        <p className="cover-tagline">Before an AI Agent Acts, RAKSHA Decides Whether It Should.</p>
        <button type="button" className="activate-button" onClick={onActivate} disabled={phase === 'activating'}>
          <span>ACTIVATE</span>
        </button>
      </div>
      {phase === 'activating' && <div className="disintegration-field" aria-hidden="true">
        {particles.map((particle, index) => (
          <i
            key={index}
            style={{
              '--px': `${particle.x}px`,
              '--py': `${particle.y}px`,
              '--pd': `${particle.delay}s`,
            } as React.CSSProperties}
          />
        ))}
      </div>}
    </div>
  )
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(readTheme)
  const [motion, setMotion] = useState<MotionMode>(readMotion)
  const [phase, setPhase] = useState<Phase>('landing')
  const [showPlaques, setShowPlaques] = useState(false)
  const [workflow, setWorkflow] = useState<WorkflowId | null>(null)
  const [provider, setProvider] = useState<ProviderMode | null>(null)
  const [gate, setGate] = useState<WorkflowId | null>(null)
  const [manualRotation, setManualRotation] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [activeStatus, setActiveStatus] = useState(false)
  const pointerX = useRef(0)

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === 'aurora' ? 'archive' : 'aurora'
      window.localStorage.setItem('raksha-theme', next)
      return next
    })
  }

  const toggleMotion = () => {
    setMotion((current) => {
      const next = current === 'lite' ? 'full' : 'lite'
      window.localStorage.setItem('raksha-motion', next)
      return next
    })
  }

  const activate = () => {
    if (phase !== 'landing') return
    setPhase('activating')
    window.setTimeout(() => setActiveStatus(true), 760)
    window.setTimeout(() => setPhase('hub'), 1650)
    window.setTimeout(() => setActiveStatus(false), 2850)
  }

  const enterWorkflow = (id: WorkflowId) => {
    if (gate) return
    setGate(id)
    setShowPlaques(false)
    window.setTimeout(() => {
      setWorkflow(id)
      setProvider(null)
      setPhase('workflow')
    }, 580)
    window.setTimeout(() => setGate(null), 920)
  }

  const home = () => {
    setWorkflow(null)
    setProvider(null)
    setShowPlaques(false)
    setPhase('hub')
  }

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('.orbit-plaque-button') || !showPlaques) return
    setDragging(true)
    pointerX.current = event.clientX
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    const delta = event.clientX - pointerX.current
    pointerX.current = event.clientX
    setManualRotation((current) => current + delta * 0.009)
  }

  const stopDrag = () => setDragging(false)

  const renderWorkflow = () => {
    if (!workflow) return null
    if (workflow === 'command') {
      if (!provider) return <ProviderSelection onChoose={setProvider} onBack={home} />
      return (
        <CommandCenter
          provider={provider}
          theme={theme}
          motion={motion}
          onBack={() => setProvider(null)}
          onDisconnect={() => setProvider(null)}
        />
      )
    }
    if (workflow === 'redteam') return <RedTeamLab onBack={home} />
    if (workflow === 'governance') return <HumanGovernance onBack={home} />
    if (workflow === 'evidence') return <EvidenceCenter onBack={home} />
    return <Policies onBack={home} />
  }

  const activated = phase !== 'landing'
  const hubVisible = phase === 'activating' || phase === 'hub'

  return (
    <div className={`raksha-app theme-${theme} motion-${motion} phase-${phase}`}>
      <div className="theme-sweep" key={theme} />

      {hubVisible && (
        <div
          className="core-hub"
          onPointerDown={startDrag}
          onPointerMove={drag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        >
          <RakshaCore
            theme={theme}
            motion={motion}
            label="RAKSHA"
            intro={phase === 'activating'}
            showPlaques={showPlaques && phase === 'hub'}
            manualRotation={manualRotation}
            dragging={dragging}
            onBrainClick={() => phase === 'hub' && setShowPlaques((value) => !value)}
            onWorkflow={enterWorkflow}
          />
          {phase === 'hub' && !showPlaques && <div className="hub-hint">CLICK THE PROTECTED CORE</div>}
          {showPlaques && <div className="orbit-hint">DRAG TO ROTATE · SELECT A PLAQUE</div>}
          {activeStatus && <div className="active-status">RAKSHA ACTIVE</div>}
        </div>
      )}

      {phase === 'workflow' && <div className="workflow-root">{renderWorkflow()}</div>}

      {(phase === 'landing' || phase === 'activating') && <Landing phase={phase} onActivate={activate} />}

      {gate && <div className={`workflow-gate gate-${gate}`}>
        <span>{workflowNames[gate]}</span>
      </div>}

      <GlobalControls
        active={activated}
        theme={theme}
        motion={motion}
        onTheme={toggleTheme}
        onMotion={toggleMotion}
        onHome={phase === 'workflow' ? home : undefined}
      />

      {phase === 'activating' && <LoadingSeal text="INITIALIZING RAKSHA" />}
    </div>
  )
}
