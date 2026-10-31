'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'

type Item = { item_name: string; display_name: string; category: string; total_qty: number; total_spend: number; times_ordered: number }

export default function MostPurchasedPage() {
  const { current } = useRestaurant()
  const restaurantId = current?.id ?? null
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!restaurantId) return
    ;(async () => {
      // Count only approved invoices — same rule as Home/Invoices:
      // headers still in Review (needs_review) are excluded. review_status
      // lives on invoice_headers, so build the approved id set first
      // (identical JS predicate to Home, so NULL counts as approved).
      const { data: headers } = await supabase
        .from('invoice_headers').select('id, review_status')
        .eq('restaurant_id', restaurantId)
      const approvedIds = new Set(
        (headers || []).filter((h: any) => h.review_status !== 'needs_review').map((h: any) => h.id)
      )
      const { data } = await supabase.from('invoice_lines').select('item_name, display_name, category, unit_qty, case_qty, total, header_id')
        .eq('restaurant_id', restaurantId)
        .gt('total', 0)
        .limit(5000)
      if (!data) { setLoading(false); return }
      const map: Record<string, Item> = {}
      data
        .filter((l: any) => approvedIds.has(l.header_id))
        .forEach((l: any) => {
          const key = l.item_name
          if (!key) return
          const label = l.display_name || l.item_name
          if (!map[key]) map[key] = { item_name: key, display_name: label, category: l.category || 'Other', total_qty: 0, total_spend: 0, times_ordered: 0 }
          map[key].total_qty += l.unit_qty || l.case_qty || 0
          map[key].total_spend += l.total || 0
          map[key].times_ordered += 1
        })
      setItems(Object.values(map).sort((a, b) => b.total_spend - a.total_spend))
      setLoading(false)
    })()
  }, [restaurantId])

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Most Purchased</h1>
      <p className="text-gray-500 text-sm mb-6">Items ranked by total spend across all invoices.</p>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <table className="w-full min-w-[600px] text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-gray-500 text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-3">#</th>
              <th className="text-left px-4 py-3">Item</th>
              <th className="text-left px-4 py-3">Category</th>
              <th className="text-right px-4 py-3">Times Ordered</th>
              <th className="text-right px-4 py-3">Total Units</th>
              <th className="text-right px-4 py-3">Total Spend</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-400">Loading...</td></tr>
            ) : items.map((item, i) => (
              <tr key={item.item_name} className="border-b last:border-0 hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-400 font-mono">{i + 1}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{item.display_name}</td>
                <td className="px-4 py-3">
                  <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full">{item.category}</span>
                </td>
                <td className="px-4 py-3 text-right text-gray-600">{item.times_ordered}x</td>
                <td className="px-4 py-3 text-right text-gray-600">{item.total_qty}</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">${item.total_spend.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
