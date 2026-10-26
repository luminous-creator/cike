import type { Judgement, Plan, ReviewResult } from '@contracts/harness'
import type { Archetype } from '@contracts/playbooks'
import type { TodayBrief } from '@contracts/today'

export type ItemType = 'once' | 'routine' | 'learning'
export type Rating = 'forgot' | 'hard' | 'good' | 'easy'

export interface TaskAnalysis {
  definition: string
  nextAction: string
  cadence: string
  generatedAt: string
}

/** 规划 harness 给出的方案（保存时的快照） */
export interface StoredPlan extends Plan {
  archetype: Archetype
  source: 'model' | 'rule'
  generatedAt: string
}

export interface StoredJudgement extends Judgement {
  source: 'model' | 'rule'
  generatedAt: string
  /** 已采用 / 已忽略的提议 */
  resolved?: 'applied' | 'dismissed'
}

export interface Item {
  id: string
  name: string
  category: string
  why?: string
  type: ItemType
  archetype?: Archetype
  priority: 1 | 2 | 3
  intervalDays: number
  currentInterval: number
  dueDate: string
  createdAt: string
  lastDoneAt?: string
  completedAt?: string
  paused: boolean
  overdueDecision?: string
  /** 固定开始时间 HH:MM */
  timeSlot?: string
  sessionMinutes?: number
  sessionsPerWeek?: number
  /** 考试 / 截止日期，学习类会据此收紧复习间隔 */
  deadline?: string
  plan?: StoredPlan
  judgement?: StoredJudgement
  /** 旧版三条分析，保留展示 */
  analysis?: TaskAnalysis
}

export interface CheckIn {
  id: string
  itemId: string
  doneAt: string
  duration?: number
  note?: string
  rating?: Rating
}

export interface Settings {
  capacityMinutesPerDay: number
}

export interface AppData {
  version: 3
  items: Item[]
  checkIns: CheckIn[]
  settings: Settings
  review?: ReviewResult
  /** 当天由模型排过的“现在做哪一件”，跨天自动失效 */
  todayBrief?: TodayBrief
}

export type View = 'today' | 'items' | 'review' | 'history' | 'settings'
