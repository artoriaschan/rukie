import { useEffect, useState } from "react";
import { Target, CircleAlert, Trash2, Pause, Play } from "lucide-react";
import type { GoalView } from "@rukie/agent";
import { Button } from "./motion/button/base";
import { Tooltip } from "./motion/tooltip";
import { useAppText } from "../lib/i18n";
import "./goal-mode.css";

/** Domain-specific Goal composition reuses installed Button and Tooltip primitives. */
export function GoalStatus({
  goal,
  disabled,
  onAction,
}: {
  goal: GoalView;
  disabled: boolean;
  onAction: (action: "pause" | "resume" | "clear") => Promise<void>;
}) {
  const t = useAppText();
  const [now, setNow] = useState(Date.now);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setNow(Date.now());
    if (!goal.armed || goal.activeSince === undefined || goal.phase === "complete") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [goal.armed, goal.activeSince, goal.phase]);
  if (goal.phase === "complete") return null;
  const limit = !goal.armed && goal.roundsStarted >= goal.maxRounds;
  const phase = limit
    ? "limit"
    : goal.phase === "blocked"
      ? "blocked"
      : goal.phase === "active" && goal.armed
        ? "running"
        : "paused";
  const Icon = phase === "blocked" || limit ? CircleAlert : Target;
  const objective = goal.objective || t("app.goal-images", { count: goal.attachments });
  const elapsed =
    goal.elapsedMs +
    (goal.armed && goal.activeSince !== undefined ? Math.max(0, now - goal.activeSince) : 0);
  const total = Math.floor(elapsed / 1000);
  const time =
    total < 60
      ? t("conversation.duration", { duration: total })
      : t("conversation.duration-minutes", {
          minutes: Math.floor(total / 60),
          seconds: total % 60,
        });
  const act = async (action: "pause" | "resume" | "clear") => {
    if (pending || disabled) return;
    setPending(true);
    try {
      await onAction(action);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="goal-status-bar text-ui-base" data-goal-phase={phase}>
      <div className="goal-status-facts">
        <Tooltip content={goal.blockedReason ?? t(`app.goal-${phase}`)}>
          <span
            tabIndex={0}
            role="img"
            aria-label={
              goal.blockedReason
                ? `${t("app.goal-blocked")}: ${goal.blockedReason}`
                : t(`app.goal-${phase}`)
            }
            className="goal-status-icon"
          >
            <Icon aria-hidden="true" />
          </span>
        </Tooltip>
        <span className="goal-status-label">{t(`app.goal-${phase}`)}</span>
        <Tooltip content={objective} wrapperClassName="goal-status-objective">
          <span tabIndex={0} aria-label={objective}>
            {objective}
          </span>
        </Tooltip>
        <span className="goal-status-time">{time}</span>
      </div>
      <div className="goal-status-actions">
        <Tooltip content={t("app.goal-delete")}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("app.goal-delete")}
            disabled={disabled || pending}
            onClick={() => void act("clear")}
          >
            <Trash2 />
          </Button>
        </Tooltip>
        <Tooltip
          content={
            limit
              ? t("app.goal-limit-description")
              : t(phase === "running" ? "app.goal-pause" : "app.goal-resume")
          }
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label={t(phase === "running" ? "app.goal-pause" : "app.goal-resume")}
            disabled={disabled || pending || limit}
            data-round-limit={limit || undefined}
            onClick={() => void act(phase === "running" ? "pause" : "resume")}
          >
            {phase === "running" ? <Pause /> : <Play />}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
