'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

export type Restaurant = {
  id: string
  name: string
  role?: string
  is_active?: boolean
  subscription_status?: string
  trial_ends_at?: string
  stripe_subscription_id?: string | null
}

type Ctx = {
  current: Restaurant | null
  list: Restaurant[]
  setCurrent: (r: Restaurant) => void
  refresh: () => Promise<Restaurant[]>
  createRestaurant: (name: string) => Promise<Restaurant | null>
  deleteRestaurant: (id: string) => Promise<void>
  loading: boolean
}

const RestaurantContext = createContext<Ctx>({
  current: null,
  list: [],
  setCurrent: () => {},
  refresh: async () => [],
  createRestaurant: async () => null,
  deleteRestaurant: async () => {},
  loading: true,
})

const LS_KEY = 'mise.active_restaurant_id'

async function fetchList(): Promise<Restaurant[]> {
  // RLS scopes this to restaurants the current user is a member of.
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, name, is_active, subscription_status, trial_ends_at, stripe_subscription_id')
    .eq('is_active', true)
    .order('name')
  if (error) {
    console.error('restaurants list', error)
    return []
  }
  return (data as Restaurant[]) || []
}

export function RestaurantProvider({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useAuth()
  const [list, setList] = useState<Restaurant[]>([])
  const [current, setCurrentState] = useState<Restaurant | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const restaurants = await fetchList()
    setList(restaurants)
    return restaurants
  }, [])

  // Only load once auth is settled and we have a session.
  useEffect(() => {
    if (authLoading) return
    let cancelled = false
    ;(async () => {
      if (!session) {
        if (cancelled) return
        setList([])
        setCurrentState(null)
        setLoading(false)
        return
      }
      setLoading(true)
      let restaurants = await refresh()
      // First-run provisioning: a self-serve signup stores the restaurant
      // name in user metadata. If this account has no restaurants yet,
      // create it automatically so signup lands on a working dashboard.
      if (restaurants.length === 0) {
        const pendingName = session.user.user_metadata?.restaurant_name
        if (typeof pendingName === 'string' && pendingName.trim()) {
          const { error: rpcError } = await supabase.rpc(
            'create_my_restaurant',
            { p_name: pendingName.trim() }
          )
          if (!rpcError) {
            restaurants = await refresh()
          } else {
            console.error('auto-create restaurant', rpcError)
          }
        }
      }
      if (cancelled) return
      const saved =
        typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null
      const initial =
        restaurants.find((r) => r.id === saved) || restaurants[0] || null
      setCurrentState(initial)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [session, authLoading, refresh])

  const setCurrent = useCallback((r: Restaurant) => {
    setCurrentState(r)
    if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, r.id)
  }, [])

  const createRestaurant = useCallback(
    async (name: string): Promise<Restaurant | null> => {
      const { data, error } = await supabase.rpc('create_my_restaurant', {
        p_name: name,
      })
      if (error) throw error
      const newId = data as string
      const restaurants = await refresh()
      const newOne = restaurants.find((r) => r.id === newId) || null
      if (newOne) setCurrent(newOne)
      return newOne
    },
    [refresh, setCurrent]
  )

  const deleteRestaurant = useCallback(
    async (id: string): Promise<void> => {
      const { error } = await supabase.rpc('delete_my_restaurant', {
        p_restaurant_id: id,
      })
      if (error) throw error
      const restaurants = await refresh()
      // If the deleted restaurant was the active one, switch to another (or clear).
      setCurrentState((prev) => {
        if (prev?.id !== id) return prev
        const next = restaurants[0] ?? null
        if (typeof window !== 'undefined') {
          if (next) localStorage.setItem(LS_KEY, next.id)
          else localStorage.removeItem(LS_KEY)
        }
        return next
      })
    },
    [refresh]
  )

  return (
    <RestaurantContext.Provider
      value={{ current, list, setCurrent, refresh, createRestaurant, deleteRestaurant, loading }}
    >
      {children}
    </RestaurantContext.Provider>
  )
}

export const useRestaurant = () => useContext(RestaurantContext)
