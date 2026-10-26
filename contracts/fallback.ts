// 纯规则版 harness：没接模型或离线时使用。服务端和浏览器共用同一份逻辑。
import type { HarnessEvent, ReviewMode, ReviewResult, Snapshot } from './harness'
import { keywordRoute, PLAYBOOKS } from './playbooks'
import { autoFixPlan, checkPlan, derivePlan, rulePlan, ruleRoute } from './planner'
import { computeBalance, computeSignals, planReview, ruleJudgement, ruleSynthesis } from './signals'

type Emit = (event: HarnessEvent) => void

export function offlinePlan(input: { intent: string; snapshot: Snapshot }, emit: Emit, reason = '未接入模型，按关键词与策略库规划'): void {
  const { snapshot } = input
  const prior = keywordRoute(input.intent)
  const route = ruleRoute(input.intent, snapshot.today)
  emit({ type: 'stage', stage: 'route', label: '路由', detail: reason })
  emit({ type: 'route', route, prior: { archetype: prior.archetype, score: prior.score }, decided: route.archetype, via: 'rule' })
  emit({ type: 'stage', stage: 'specialist', label: '专家方案', detail: `套用「${PLAYBOOKS[route.archetype].label}」模板` })
  const { plan, fixes } = autoFixPlan(rulePlan(route, snapshot), route.archetype, snapshot)
  emit({ type: 'stage', stage: 'verify', label: '评审', detail: '按策略库逐条检查' })
  const { checks } = checkPlan(plan, route.archetype, snapshot)
  emit({ type: 'accepted', target: '方案', label: `${checks.filter((c) => c.ok).length}/${checks.length} 项通过` })
  emit({ type: 'plan', result: { route, plan, derived: derivePlan(plan, route.archetype, snapshot), checks, autoFixed: fixes, source: 'rule' } })
}

export function offlineReview(input: { mode: ReviewMode; itemId?: string; snapshot: Snapshot }, emit: Emit, reason = '未接入模型，使用确定性规则'): ReviewResult {
  const started = Date.now()
  const { snapshot } = input
  const signals = computeSignals(snapshot)
  const balance = computeBalance(snapshot, signals)
  const plan = planReview(snapshot, signals, balance, input.mode, input.itemId)
  emit({ type: 'agenda', agenda: plan.agenda, induce: plan.induce, notes: plan.notes, budget: 0 })
  emit({ type: 'stage', stage: 'rules', label: '规则评判', detail: reason })
  const judgements = plan.agenda.map((entry) => {
    const judgement = { ...ruleJudgement(entry, signals.get(entry.itemId)!, balance.find((r) => r.itemId === entry.itemId)), source: 'rule' as const }
    emit({ type: 'judgement', judgement })
    return judgement
  })
  let synthesis: ReviewResult['synthesis'] = null
  if (plan.induce) {
    const ruled = ruleSynthesis(snapshot, signals, balance, plan.allowPatterns)
    if (ruled.focus.length) {
      synthesis = { ...ruled, source: 'rule' }
      emit({ type: 'synthesis', synthesis })
    }
  }
  const result: ReviewResult = {
    mode: input.mode, generatedAt: new Date().toISOString(), judgements, synthesis, balance,
    stats: { steps: 0, rejected: 0, durationMs: Date.now() - started, model: null, tokens: null },
  }
  emit({ type: 'review', result })
  return result
}
