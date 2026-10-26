// 策略库：把调研结论落成路由目标。每一类任务对应一套"怎么做最好"的方法、数值范围和文献依据。
// 前后端共用：服务端用它约束模型输出，前端用它展示依据。

export type Archetype = 'memory' | 'concept' | 'skill' | 'project' | 'habit' | 'errand'
export type ItemType = 'once' | 'routine' | 'learning'

export const REFS = {
  murre2015: {
    short: 'Murre & Dros, 2015',
    title: 'Replication and Analysis of Ebbinghaus’ Forgetting Curve',
    venue: 'PLOS ONE',
    url: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0120644',
    finding: '复现了艾宾浩斯遗忘曲线：遗忘在最初一天最陡，首轮复习放在 24 小时左右最划算。',
  },
  cepeda2008: {
    short: 'Cepeda et al., 2008',
    title: 'Spacing Effects in Learning: A Temporal Ridgeline of Optimal Retention',
    venue: 'Psychological Science',
    url: 'https://pubmed.ncbi.nlm.nih.gov/19076480/',
    finding: '最佳复习间隔取决于要记多久：记一周约取 20–40%，记一年约取 5–10%。没有放之四海皆准的“每两天”。',
  },
  roediger2006: {
    short: 'Roediger & Karpicke, 2006',
    title: 'Test-Enhanced Learning',
    venue: 'Psychological Science',
    url: 'https://www.gwern.net/docs/spaced-repetition/2006-roediger.pdf',
    finding: '合上书自测（提取练习）比重读保持得更久；只看 5 分钟后的效果会误以为重读更好。',
  },
  dunlosky2013: {
    short: 'Dunlosky et al., 2013',
    title: 'Improving Students’ Learning With Effective Learning Techniques',
    venue: 'Psychological Science in the Public Interest',
    url: 'https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html',
    finding: '十种学习法中“练习测试”和“分散练习”效用最高；划线、重读、摘要效用低。',
  },
  fsrs: {
    short: 'FSRS（开源间隔重复算法）',
    title: 'Free Spaced Repetition Scheduler',
    venue: 'Anki / open-spaced-repetition',
    url: 'https://domenic.me/fsrs/',
    finding: '按目标记忆率（常用 90%）和每次回忆结果动态拉长间隔，而不是固定表格。',
  },
  donovan1999: {
    short: 'Donovan & Radosevich, 1999',
    title: 'A Meta-Analytic Review of the Distribution of Practice Effect',
    venue: 'Journal of Applied Psychology',
    url: 'https://www.gwern.net/docs/spaced-repetition/1999-donovan.pdf',
    finding: '技能练习同样是分散优于集中（d≈0.46），但效果随任务类型和间隔变化。',
  },
  gollwitzer2006: {
    short: 'Gollwitzer & Sheeran, 2006',
    title: 'Implementation Intentions and Goal Achievement: A Meta-Analysis',
    venue: 'Advances in Experimental Social Psychology',
    url: 'https://stafforini.com/works/gollwitzer-2006-implementation-intentions-and/',
    finding: '写下“如果到了某时某地，我就做某事”的计划，目标达成效应 d≈0.65（中到大）。',
  },
  lally2010: {
    short: 'Lally et al., 2010',
    title: 'How Are Habits Formed: Modelling Habit Formation in the Real World',
    venue: 'European Journal of Social Psychology',
    url: 'https://www.ucl.ac.uk/news/2009/aug/how-long-does-it-take-form-habit',
    finding: '同一情境下重复，自动化平均约 66 天（18–254 天不等）；偶尔漏一次影响很小，连续漏一周才伤。',
  },
  leroy2009: {
    short: 'Leroy, 2009',
    title: 'Why Is It So Hard to Do My Work? Attention Residue',
    venue: 'Organizational Behavior and Human Decision Processes',
    url: 'https://doi.org/10.1016/j.obhdp.2009.04.002',
    finding: '在没收尾的任务之间切换会留下“注意力残留”，拖累下一件事。',
  },
  masicampo2011: {
    short: 'Masicampo & Baumeister, 2011',
    title: 'Consider It Done! Plan Making Can Eliminate the Cognitive Effects of Unfulfilled Goals',
    venue: 'Journal of Personality and Social Psychology',
    url: 'https://pubmed.ncbi.nlm.nih.gov/?term=Consider+it+done+plan+making+unfulfilled+goals+Masicampo',
    finding: '给未完成的事写下具体计划，就能消除它在脑中的反复打扰。',
  },
  buehler1994: {
    short: 'Buehler, Griffin & Ross, 1994',
    title: 'Exploring the “Planning Fallacy”',
    venue: 'Journal of Personality and Social Psychology',
    url: 'https://bear.warrington.ufl.edu/brenner/mar7588/Papers/buehler-et-al-1994.pdf',
    finding: '人会系统性低估自己完成任务的时间：毕业论文平均预估 34 天，实际 55.5 天。',
  },
  biwer2023: {
    short: 'Biwer et al., 2023',
    title: 'Understanding Effort Regulation: Pomodoro Breaks vs Self-Regulated Breaks',
    venue: 'British Journal of Educational Psychology',
    url: 'https://pubmed.ncbi.nlm.nih.gov/36859717/',
    finding: '预设休息（学 24 分钟歇 6 分钟）比随意休息疲劳更低、情绪更好，完成量相当且用时更短。',
  },
} as const

export type RefKey = keyof typeof REFS
export const REF_KEYS = Object.keys(REFS) as RefKey[]

interface Range { min: number; max: number; default: number }

export interface Playbook {
  id: Archetype
  label: string
  examples: string
  itemType: ItemType
  /** 一句话方法 */
  method: string
  principles: { text: string; ref: RefKey }[]
  session: Range
  /** 非学习类：每周次数 */
  sessionsPerWeek?: Range
  /** 学习类：第一次复习间隔（天） */
  firstInterval?: Range
  /** 是否必须固定时段 */
  fixedSlot: boolean
  /** 步骤里必须出现主动回忆类动作 */
  retrieval: boolean
  breaks?: string
}

export const PLAYBOOKS: Record<Archetype, Playbook> = {
  memory: {
    id: 'memory', label: '记忆型学习', examples: '单词、公式、考点、术语', itemType: 'learning',
    method: '间隔检索：先自测再对答案，间隔逐次拉长',
    principles: [
      { text: '第一次复习放在学完后约 1 天，遗忘在这段最陡', ref: 'murre2015' },
      { text: '之后按回忆结果拉长间隔；考试越近，间隔上限越短', ref: 'cepeda2008' },
      { text: '复习 = 合上书回忆 / 默写 / 做题，不是重读', ref: 'roediger2006' },
    ],
    session: { min: 10, max: 30, default: 20 },
    firstInterval: { min: 1, max: 2, default: 1 },
    fixedSlot: false, retrieval: true,
  },
  concept: {
    id: 'concept', label: '理解型学习', examples: '一门课、一章教材、一篇论文、一本书', itemType: 'learning',
    method: '先学一遍做自我解释，再用间隔自测巩固',
    principles: [
      { text: '分散练习和练习测试是效用最高的两种学习法', ref: 'dunlosky2013' },
      { text: '学完不要立刻重读，隔 1–3 天先合书回忆要点', ref: 'roediger2006' },
      { text: '整块学习用预设休息（约 25 分钟一歇）', ref: 'biwer2023' },
    ],
    session: { min: 30, max: 90, default: 50 },
    firstInterval: { min: 1, max: 3, default: 2 },
    fixedSlot: false, retrieval: true,
    breaks: '学 25 分钟，歇 5 分钟',
  },
  skill: {
    id: 'skill', label: '技能型练习', examples: '编程、乐器、口语、写作、画画、刷题', itemType: 'routine',
    method: '分散刻意练习：固定时段、每次只攻一个子技能',
    principles: [
      { text: '技能练习也是分散优于集中，一周多次短练胜过一次长练', ref: 'donovan1999' },
      { text: '把练习钉在固定时间和地点，更容易真的开始', ref: 'gollwitzer2006' },
      { text: '每次开头先不看资料复现上次内容', ref: 'roediger2006' },
    ],
    session: { min: 20, max: 90, default: 45 },
    sessionsPerWeek: { min: 3, max: 6, default: 4 },
    fixedSlot: true, retrieval: false,
  },
  project: {
    id: 'project', label: '项目推进', examples: '作品集、比赛、论文、开发、视频、策划', itemType: 'routine',
    method: '固定时段整块推进，一块只做一个项目，收工写下一步',
    principles: [
      { text: '固定“何时何地做什么”的如果-那么计划，效应 d≈0.65', ref: 'gollwitzer2006' },
      { text: '一个时段只推一个项目，避免切换留下注意力残留', ref: 'leroy2009' },
      { text: '收工前写下“下一步”，未完成的事就不再反复打扰', ref: 'masicampo2011' },
      { text: '人总会低估耗时，预算按自己的历史记录校准', ref: 'buehler1994' },
    ],
    session: { min: 45, max: 150, default: 90 },
    sessionsPerWeek: { min: 2, max: 7, default: 5 },
    fixedSlot: true, retrieval: false,
  },
  habit: {
    id: 'habit', label: '习惯养成', examples: '运动、早睡、阅读、喝水、冥想', itemType: 'routine',
    method: '小起步 + 固定触发点，漏一次不要紧，别连漏',
    principles: [
      { text: '同一情境重复约 66 天才自动化，偶尔漏一次影响很小', ref: 'lally2010' },
      { text: '用“做完 A 之后，我就做 B”绑定触发点', ref: 'gollwitzer2006' },
    ],
    session: { min: 2, max: 40, default: 10 },
    sessionsPerWeek: { min: 4, max: 7, default: 7 },
    fixedSlot: true, retrieval: false,
  },
  errand: {
    id: 'errand', label: '一次性事务', examples: '交材料、预约、报名、打电话、买东西', itemType: 'once',
    method: '定好哪天几点做，写成如果-那么，一次做完',
    principles: [
      { text: '给事务指定具体时间和触发点，比“有空就做”可靠得多', ref: 'gollwitzer2006' },
      { text: '写下计划后它就不会一直占着脑子', ref: 'masicampo2011' },
    ],
    session: { min: 5, max: 120, default: 20 },
    fixedSlot: false, retrieval: false,
  },
}

export const ARCHETYPES = Object.keys(PLAYBOOKS) as Archetype[]

// 关键词先验：路由的"第二意见"。模型没把握或离线时，用它兜底。
const PRIORS: Record<Archetype, RegExp[]> = {
  memory: [/单词|词汇|生词|背|公式|考点|知识点|术语|默写|记住|记忆|口诀|年代|定义/],
  concept: [/课程?|章节?|教材|读完|看完|这本书|论文阅读|文献|理解|原理|理论|网课|复习.{0,4}(章|课|科)/],
  skill: [/练|编程|代码|算法|刷题|吉他|钢琴|口语|听力|写作|画画|素描|摄影|剪辑|打字|手速/],
  project: [/项目|作品集|比赛|竞赛|论文|毕设|开发|网站|小程序|app|系统|视频|策划|创业|课题|报告|路演|产品/i],
  habit: [/每天|早起|早睡|运动|跑步|健身|喝水|冥想|日记|坚持|戒掉?|养成|习惯|拉伸/],
  errand: [/交|提交|打电话|预约|买|报名|缴费?|寄|填表?|发邮件|取件?|办理?|续费|退/],
}

export function keywordRoute(text: string): { archetype: Archetype; score: number; scores: Record<Archetype, number> } {
  const scores = Object.fromEntries(ARCHETYPES.map((id) => [id, PRIORS[id].reduce((sum, re) => sum + (text.match(new RegExp(re, 'g'))?.length ?? 0), 0)])) as Record<Archetype, number>
  const archetype = ARCHETYPES.reduce((best, id) => (scores[id] > scores[best] ? id : best), 'project' as Archetype)
  return { archetype, score: scores[archetype], scores }
}

export function intervalFromSessions(sessionsPerWeek: number): number {
  return Math.max(1, Math.round(7 / Math.max(1, sessionsPerWeek)))
}

/** Cepeda 2008 的"时间山脊"：给定离考试/截止还有几天，复习间隔的合理上限 */
export function ridgelineCap(daysToDeadline: number): number {
  if (daysToDeadline <= 0) return 1
  const ratio = daysToDeadline <= 7 ? 0.3 : daysToDeadline <= 30 ? 0.2 : daysToDeadline <= 180 ? 0.12 : 0.08
  return Math.max(1, Math.round(daysToDeadline * ratio))
}

/** 预览前几次复习：从首个间隔开始按约 2 倍扩张，受截止日期山脊上限约束 */
export function reviewPreview(firstInterval: number, daysToDeadline: number | null, count = 5): number[] {
  const offsets: number[] = []
  let gap = Math.max(1, firstInterval)
  let at = 0
  for (let i = 0; i < count; i += 1) {
    const cap = daysToDeadline !== null ? ridgelineCap(daysToDeadline - at) : Infinity
    const step = Math.max(1, Math.min(gap, cap))
    at += step
    if (daysToDeadline !== null && at > daysToDeadline) break
    offsets.push(at)
    gap = Math.round(gap * 2.2)
  }
  return offsets
}
