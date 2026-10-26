import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { addDays, localDate } from '@/lib/scheduler'
import type { Item } from '@/types'

interface Props {
  items: Item[]
  onKeep: (item: Item) => void
  onPostpone: (item: Item) => void
}

export function OverdueDialog({ items, onKeep, onPostpone }: Props) {
  return (
    <Dialog open={items.length > 0}>
      <DialogContent className="app-dialog" showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <p className="section-code">A SMALL RESET / 调整一下</p>
          <DialogTitle className="dialog-title">这些项目过了建议日期</DialogTitle>
          <DialogDescription>没有关系。选择继续保留，或把它轻轻推到明天。</DialogDescription>
        </DialogHeader>
        <div className="overdue-list">
          {items.map((item) => (
            <div className="overdue-row" key={item.id}>
              <div><strong>{item.name}</strong><span>建议日期 {item.dueDate}</span></div>
              <div className="overdue-actions">
                <button className="button-secondary" onClick={() => onKeep(item)}>继续保留</button>
                <button className="button-primary" onClick={() => onPostpone({ ...item, dueDate: addDays(localDate(), 1) })}>顺延到明天</button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
