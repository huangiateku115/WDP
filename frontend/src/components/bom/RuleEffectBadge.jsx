import { Badge } from "@/components/ui/badge";
import { RULE_PHASE_LABELS, RULE_PHASE_TONE, rulePhase } from "@/lib/ruleEffect";

// Effective-period badge for pricing rules and business policies. It answers what the plain
// ACTIVE/INACTIVE status cannot: is this rule in force now, scheduled for later, or closed?
export default function RuleEffectBadge({ record }) {
  const phase = rulePhase(record);
  return <Badge variant={RULE_PHASE_TONE[phase]}>{RULE_PHASE_LABELS[phase]}</Badge>;
}
