import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionStore } from '@/store/useSessionStore';
import { todayKey } from '@/lib/date';
import { HeaderLeft } from './HeaderLeft';
import type { Session } from '@/types';

function FocusBackground() {
  const orbs = useMemo(
    () => [
      { size: 350, x: '15%', y: '20%', delay: 0, duration: 8, color: 'rgba(255, 220, 180, 0.4)' },
      { size: 280, x: '75%', y: '15%', delay: 1, duration: 10, color: 'rgba(255, 200, 150, 0.35)' },
      { size: 250, x: '80%', y: '75%', delay: 2, duration: 9, color: 'rgba(255, 240, 200, 0.3)' },
      { size: 320, x: '20%', y: '80%', delay: 0.5, duration: 11, color: 'rgba(255, 180, 120, 0.4)' },
      { size: 200, x: '50%', y: '50%', delay: 1.5, duration: 7, color: 'rgba(255, 255, 230, 0.25)' },
    ],
    [],
  );

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      {orbs.map((orb, i) => (
        <motion.div
          key={i}
          style={{
            position: 'absolute',
            left: `calc(${orb.x} - ${orb.size / 2}px)`,
            top: `calc(${orb.y} - ${orb.size / 2}px)`,
            width: orb.size,
            height: orb.size,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${orb.color}, transparent 70%)`,
            filter: 'blur(60px)',
          }}
          animate={{
            x: [0, 40, -30, 20, 0],
            y: [0, -35, 25, -15, 0],
            scale: [1, 1.2, 0.85, 1.15, 1],
          }}
          transition={{
            duration: orb.duration,
            delay: orb.delay,
            repeat: Infinity,
            repeatType: 'mirror',
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

function fmtDuration(secs: number) {
  if (secs < 60) return `${secs} sec`;
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function fmtClock(d: Date) {
  return (
    String(d.getHours()).padStart(2, '0') +
    ':' +
    String(d.getMinutes()).padStart(2, '0') +
    ':' +
    String(d.getSeconds()).padStart(2, '0')
  );
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

type Phase = 'active' | 'celebrating';

export function FocusModal({ onClose }: { onClose: () => void }) {
  const toggleDone = useSessionStore((s) => s.toggleDone);
  const todaySessions = useSessionStore((s) => s.sessions[todayKey()] ?? []);

  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isRunning, setIsRunning] = useState(true);
  const [phase, setPhase] = useState<Phase>('active');
  const [focusedSeconds, setFocusedSeconds] = useState(0);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─────── detect active session (re-checks every 15s) ───────
  useEffect(() => {
    const detect = () => {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const match = todaySessions.find((s) => {
        if (s.done) return false;
        const [h, m] = s.time.split(':').map(Number);
        const start = h * 60 + m;
        const end = start + (parseInt(String(s.duration)) || 0);
        return nowMin >= start && nowMin < end;
      });
      if (match && (!activeSession || activeSession.id !== match.id)) {
        const [h, m] = match.time.split(':').map(Number);
        const end = new Date(now);
        end.setHours(h, m + (parseInt(String(match.duration)) || 0), 0, 0);
        const remaining = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 1000));
        const full = (parseInt(String(match.duration)) || 0) * 60;
        setActiveSession(match);
        setTotalSeconds(Math.max(full, remaining));
        setTimeRemaining(remaining);
        setFocusedSeconds(Math.max(0, full - remaining));
        setIsRunning(true);
        setPhase('active');
      } else if (!match && activeSession) {
        setActiveSession(null);
      }
    };
    detect();
    const id = setInterval(detect, 15_000);
    return () => clearInterval(id);
  }, [todaySessions, activeSession]);

  // ─────── countdown + completion ───────
  useEffect(() => {
    if (phase !== 'active' || !isRunning || timeRemaining <= 0) {
      if (phase === 'active' && timeRemaining === 0 && activeSession) {
        setPhase('celebrating');
      }
      return;
    }
    timerRef.current = setTimeout(() => {
      setTimeRemaining((p) => p - 1);
      setFocusedSeconds((p) => p + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [phase, isRunning, timeRemaining, activeSession]);

  // ─────── ESC closes ───────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ─────── handlers ───────
  const handleReset = () => {
    if (!activeSession) return;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const [h, m] = activeSession.time.split(':').map(Number);
    const start = h * 60 + m;
    const end = start + activeSession.duration;
    let remaining: number;
    if (nowMin >= start && nowMin < end) {
      const endDate = new Date(now);
      endDate.setHours(h, m + activeSession.duration, 0, 0);
      remaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / 1000));
    } else {
      remaining = activeSession.duration * 60;
    }
    setTimeRemaining(remaining);
    setTotalSeconds(Math.max(activeSession.duration * 60, remaining));
    setFocusedSeconds(0);
    setPhase('active');
    setIsRunning(true);
  };

  const handleComplete = () => {
    setPhase('celebrating');
  };

  const handleBackToDashboard = () => {
    if (activeSession && !activeSession.done) {
      toggleDone(todayKey(), activeSession.id);
    }
    onClose();
  };

  // ─────── empty state ───────
  if (!activeSession) {
    return <EmptyState onClose={onClose} onBack={onClose} />;
  }

  // ─────── celebration state ───────
  if (phase === 'celebrating') {
    const currentlyDone = todaySessions.filter((s) => s.done).length;
    const totalCount = todaySessions.length;
    const doneAfter = currentlyDone + (activeSession.done ? 0 : 1);
    return (
      <Celebration
        session={activeSession}
        focusedLabel={fmtDuration(focusedSeconds)}
        doneCount={doneAfter}
        totalCount={totalCount}
        onBack={handleBackToDashboard}
        onClose={onClose}
      />
    );
  }

  // ─────── active focus state ───────
  const progressPct = totalSeconds > 0 ? (timeRemaining / totalSeconds) * 100 : 0;
  const mins = Math.floor(timeRemaining / 60);
  const secs = timeRemaining % 60;
  const timerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return (
    <motion.div
      className="focus-backdrop"
      role="dialog"
      aria-modal="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <FocusBackground />
      <header className="focus-header">
        <HeaderLeft
          actionLabel="Exit focus"
          actionIcon={
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18l-6-6 6-6" />
              <path d="M3 12h18" />
            </svg>
          }
          onAction={onClose}
          actionTitle="Exit focus mode"
          variant="focus"
        />
      </header>

      <main className="focus-stage">
        <div className="focus-meta">
          <div className="focus-subject-row">
            <span
              className="focus-subject-dot"
              style={{ background: activeSession.color }}
            />
            <span className="focus-subject-name">{activeSession.subject}</span>
          </div>
          <h1 className="focus-topic-title">{activeSession.topic || activeSession.subject}</h1>
        </div>

        <div className="focus-timer">
          <span
            className={'focus-timer-digits' + (isRunning ? ' running' : ' paused')}
          >
            {timerText}
          </span>
        </div>

        <div className="focus-progress" aria-hidden="true">
          <div
            className="focus-progress-fill"
            style={{
              width: `${progressPct}%`,
              background: `linear-gradient(90deg, ${activeSession.color}, #fff)`,
            }}
          />
        </div>

        <div className="focus-controls">
          <button
            type="button"
            className={'focus-btn focus-btn-primary' + (isRunning ? ' is-paused' : '')}
            onClick={() => setIsRunning((r) => !r)}
          >
            {isRunning ? '❚❚ Pause' : '▶ Resume'}
          </button>
          <button
            type="button"
            className="focus-btn focus-btn-ghost"
            onClick={handleReset}
            title="Restart timer"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
          <button
            type="button"
            className="focus-btn focus-btn-ghost"
            onClick={handleComplete}
            title="Mark session done"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <polyline points="9 12 11 14 15 10" />
            </svg>
          </button>
        </div>
      </main>

      <FocusClock />
    </motion.div>
  );
}

// ─────── empty state ───────
function EmptyState({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  return (
    <motion.div
      className="focus-backdrop"
      role="dialog"
      aria-modal="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <FocusBackground />
      <header className="focus-header">
        <HeaderLeft
          actionLabel="Exit focus"
          actionIcon={
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18l-6-6 6-6" />
              <path d="M3 12h18" />
            </svg>
          }
          onAction={onClose}
          actionTitle="Exit focus mode"
          variant="focus"
        />
      </header>

      <main className="focus-stage focus-stage-empty">
        <div className="focus-empty">
          <div className="focus-empty-icon">⏳</div>
          <h2 className="focus-empty-title">No active session</h2>
          <p className="focus-empty-desc">
            Focus mode kicks in automatically when a scheduled session is running. add a session
            for now or wait for the next one to start.
          </p>
          <button type="button" className="focus-btn focus-btn-primary" onClick={onBack}>
            Back to dashboard
          </button>
        </div>
      </main>

      <FocusClock />
    </motion.div>
  );
}

// ─────── clock widget (bottom-right, same family as main page) ───────
function FocusClock() {
  const [t, setT] = useState(() => fmtClock(new Date()));
  const [date, setDate] = useState(() => fmtDate(new Date()));
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      setT(fmtClock(now));
      setDate(fmtDate(now));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="focus-clock">
      <div className="focus-clock-label">now</div>
      <div className="focus-clock-time">
        {t.split(':').map((part, i) => (
          <span key={i}>
            {i > 0 && <span className="focus-clock-sep">:</span>}
            {part}
          </span>
        ))}
      </div>
      <div className="focus-clock-date">{date}</div>
    </div>
  );
}

// ─────── celebration screen ───────
function Celebration({
  session,
  focusedLabel,
  doneCount,
  totalCount,
  onBack,
  onClose,
}: {
  session: Session;
  focusedLabel: string;
  doneCount: number;
  totalCount: number;
  onBack: () => void;
  onClose: () => void;
}) {
  const sparks = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        i,
        angle: (i / 14) * 360,
        delay: (i % 5) * 0.05,
      })),
    [],
  );

  return (
    <motion.div
      className="focus-backdrop"
      role="dialog"
      aria-modal="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <FocusBackground />
      <header className="focus-header">
        <HeaderLeft
          actionLabel="Exit focus"
          actionIcon={
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18l-6-6 6-6" />
              <path d="M3 12h18" />
            </svg>
          }
          onAction={onClose}
          actionTitle="Exit focus mode"
          variant="focus"
        />
      </header>

      <main className="focus-stage">
        <div className="focus-card focus-card-celebrate">
          <div className="focus-card-glow" />
          <div className="focus-card-inner focus-celebrate-inner">
            <div className="focus-checkwrap" style={{ background: session.color }}>
              {sparks.map((s) => (
                <span
                  key={s.i}
                  className="focus-spark"
                  style={{
                    transform: `rotate(${s.angle}deg) translateY(-44px)`,
                    animationDelay: `${s.delay}s`,
                    background: session.color,
                  }}
                />
              ))}
              <svg
                viewBox="0 0 24 24"
                width="32"
                height="32"
                fill="none"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="4 12 10 18 20 6" />
              </svg>
            </div>

            <span
              className="focus-subject-tag"
              style={{ borderLeftColor: session.color }}
            >
              {session.subject}
            </span>
            <h1 className="focus-topic-title">session complete</h1>
            <p className="focus-celebrate-topic">{session.topic || session.subject}</p>

            <div className="focus-stats">
              <div className="focus-stat">
                <span className="focus-stat-value">{focusedLabel}</span>
                <span className="focus-stat-label">focused</span>
              </div>
              <div className="focus-stat-divider" />
              <div className="focus-stat">
                <span className="focus-stat-value">
                  {doneCount}
                  <span className="focus-stat-of">/{totalCount}</span>
                </span>
                <span className="focus-stat-label">done today</span>
              </div>
            </div>

            <button
              type="button"
              className="focus-btn focus-btn-primary focus-btn-lg"
              onClick={onBack}
            >
              Back to dashboard
            </button>
          </div>
        </div>
      </main>
    </motion.div>
  );
}
