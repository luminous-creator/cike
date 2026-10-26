export type ItemType = 'once' | 'routine' | 'learning'
export type Rating = 'forgot' | 'hard' | 'good' | 'easy'

export interface TaskAnalysis {
  definition: string
  nextAction: string
  cadence: string
  generatedAt: string
}

export interface Item {
  id: string
  name: string
  category: string
  why?: string
  type: ItemType
  priority: 1 | 2 | 3
  intervalDays: number
  currentInterval: number
  dueDate: string
  createdAt: string
  lastDoneAt?: string
  completedAt?: string
  paused: boolean
  overdueDecision?: string
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

export interface AppData {
  version: 2
  items: Item[]
  checkIns: CheckIn[]
}

export type View = 'today' | 'items' | 'history' | 'settings'
