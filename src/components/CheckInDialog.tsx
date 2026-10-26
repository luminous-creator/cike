import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ratingLabels } from '@/lib/scheduler'
import type { CheckIn, Item, Rating } from '@/types'

interface Props {
  item: Item | null
  onOpenChange: (open: boolean) => void
  onSave: (checkIn: CheckIn) => void
}

export function CheckInDialog({ item, onOpenChange, onSave }: Props) {
  const [duration, setDuration] = useState('')
  const [note, setNote] = useState('')
  const [rating, setRating] = useState<Rating | undefined>()

  useEffect(() => {
    if (!item) return
    setDuration('')
    setNote('')
    setRating(undefined)
  }, [item])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!item || (item.type === 'learning' && !rating)) return
    onSave({
      id: crypto.randomUUID(),
      itemId: item.id,
      doneAt: new Date().toISOString(),
      duration: duration ? Math.max(0, Number(duration)) : undefined,
      note: note.trim() || undefined,
      rating: item.type === 'learning' ? rating : undefined,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent className="app-dialog">
        <DialogHeader>
          <p className="section-code">CHECK IN / 记录一次行动</p>
          <DialogTitle className="dialog-title">{item?.name}</DialogTitle>
          <DialogDescription>完成就已经很好。时长和备注都可以留空。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="form-stack">
          {item?.type === 'learning' && (
            <fieldset className="field-label">这次回忆起来怎么样？
              <div className="rating-grid">
                {(Object.keys(ratingLabels) as Rating[]).map((key) => (
                  <button key={key} type="button" className={rating === key ? 'rating selected' : 'rating'} onClick={() => setRating(key)}>
                    <strong>{ratingLabels[key].title}</strong>
                    <span>{ratingLabels[key].description}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <label className="field-label">投入时长（分钟，可选）
            <input type="number" min={0} max={1440} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="不填也可以" />
          </label>
          <label className="field-label">留一句备注（可选）
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="记录进展、卡点或下一步" rows={3} maxLength={500} />
          </label>
          <div className="dialog-actions">
            <button type="button" className="button-secondary" onClick={() => onOpenChange(false)}>取消</button>
            <button type="submit" className="button-primary" disabled={item?.type === 'learning' && !rating}>完成打卡</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
