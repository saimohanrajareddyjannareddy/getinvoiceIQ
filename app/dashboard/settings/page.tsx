'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/lib/restaurant'
import { CheckCircle, AlertCircle, Link2, Key, AlertTriangle, Trash2, CreditCard, X, Mail, MessageCircle } from 'lucide-react'
import { useActivity } from '@/lib/activity'

type DeletionCounts = {
  invoice_files: number
  invoice_headers: number
  invoice_lines: number
  pos_sales: number
  members: number
}

export default function SettingsPage() {
  const { current, deleteRestaurant } = useRestaurant()
  const activity = useActivity()
  const restaurantId = current?.id ?? null
  const restaurantName = current?.name ?? ''
  const [merchantId, setMerchantId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [connected, setConnected] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  // Clover OAuth state
  const [oauthConfigured, setOauthConfigured] = useState(false)
  const [oauthEnv, setOauthEnv] = useState('')
  const [oauthConnected, setOauthConnected] = useState(false)
  const [cloverBanner, setCloverBanner] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  // Billing state
  const [billingConfigured, setBillingConfigured] = useState(false)
  const [hasSubscription, setHasSubscription] = useState(false)
  const [billingBusy, setBillingBusy] = useState(false)
  const [billingMsg, setBillingMsg] = useState<string | null>(null)
  const [billingHistory, setBillingHistory] = useState<{
    invoices: any[]
    subscription: any | null
  } | null>(null)

  // Email scan state
  const [mailConfigured, setMailConfigured] = useState(false)
  const [mailConnected, setMailConnected] = useState(false)
  const [mailEmail, setMailEmail] = useState('')
  const [mailLastScan, setMailLastScan] = useState<string | null>(null)
  const [mailBanner, setMailBanner] = useState<string | null>(null)
  const [mailScanning, setMailScanning] = useState(false)
  const [mailMsg, setMailMsg] = useState<string | null>(null)

  // WhatsApp intake: server configuration + this restaurant's
  // registered sender numbers (routing table, migration 019).
  type WaSender = { id: string; phone: string; label: string | null; kind: string }
  const [waConfigured, setWaConfigured] = useState(false)
  const [waIntakeNumber, setWaIntakeNumber] = useState<string | null>(null)
  const [waNumbers, setWaNumbers] = useState<WaSender[]>([])
  const [waNewPhone, setWaNewPhone] = useState('')
  const [waNewLabel, setWaNewLabel] = useState('')
  const [waNewKind, setWaNewKind] = useState<'staff' | 'supplier'>('staff')
  const [waBusy, setWaBusy] = useState(false)
  const [waMsg, setWaMsg] = useState<string | null>(null)

  // Business cards state
  const [cards, setCards] = useState<string[]>([])
  const [newCard, setNewCard] = useState('')
  const [cardStatus, setCardStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [cardErr, setCardErr] = useState<string | null>(null)

  // Danger Zone state
  const [counts, setCounts] = useState<DeletionCounts | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState<string | null>(null)

  // Delete-account state
  const [accountEmail, setAccountEmail] = useState<string | null>(null)
  const [confirmEmailText, setConfirmEmailText] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [deleteAccountErr, setDeleteAccountErr] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setAccountEmail(data.user?.email ?? null))
  }, [])

  useEffect(() => {
    if (!restaurantId) return
    ;(async () => {
      const full = await supabase
        .from('restaurant_settings')
        .select('clover_merchant_id, clover_api_key, clover_auth_method')
        .eq('restaurant_id', restaurantId)
        .single()
      let settings: {
        clover_merchant_id: string | null
        clover_api_key: string | null
        clover_auth_method?: string | null
      } | null = full.data
      if (full.error) {
        // Pre-012 database: the OAuth columns don't exist yet.
        const legacy = await supabase
          .from('restaurant_settings')
          .select('clover_merchant_id, clover_api_key')
          .eq('restaurant_id', restaurantId)
          .single()
        settings = legacy.data
      }
      if (settings) {
        setMerchantId(settings.clover_merchant_id || '')
        setApiKey(settings.clover_api_key ? '••••••••' : '')
        const isOauth = settings.clover_auth_method === 'oauth'
        setOauthConnected(isOauth)
        setConnected(!!(settings.clover_merchant_id && settings.clover_api_key) || isOauth)
      } else {
        setMerchantId('')
        setApiKey('')
        setConnected(false)
        setOauthConnected(false)
      }
    })()
  }, [restaurantId])

  // OAuth availability on the server + the result banner after the
  // callback redirects back here with ?clover=<result>.
  useEffect(() => {
    fetch('/api/clover/status')
      .then((r) => r.json())
      .then((j) => {
        setOauthConfigured(!!j.oauth_configured)
        setOauthEnv(j.env || '')
      })
      .catch(() => {})
    const result = new URLSearchParams(window.location.search).get('clover')
    if (result) {
      const messages: Record<string, string> = {
        connected: 'Clover connected. Sales will sync with your OAuth token, stored encrypted.',
        not_configured: "Clover OAuth isn't configured on the server yet — the app credentials are missing.",
        migration_needed: 'Almost there: run sql/012_clover_oauth.sql in the Supabase SQL editor, then connect again.',
        no_encryption_key: 'The server is missing its token encryption key (TOKEN_ENCRYPTION_KEY). Set it, then connect again.',
        failed: "The Clover connection didn't complete. Try again.",
        missing_restaurant: "The Clover connection didn't complete. Try again.",
        no_code: 'Clover sent you back without an authorization code (step: code). Try again — and mention code "no_code" if it repeats.',
        no_state: 'Clover sent you back without the state value (step: state). Try again — and mention code "no_state" if it repeats.',
        cookie_missing: 'The connection cookie was lost on the way back from Clover (step: cookie). Try again in the same browser tab — and mention code "cookie_missing" if it repeats.',
        state_mismatch: 'The connection state did not match (step: state check) — usually a stale tab. Close extra getinvoiceIQ tabs and try again; mention code "state_mismatch" if it repeats.',
        exchange_no_token: 'Clover answered the token exchange without a token (step: exchange). Mention code "exchange_no_token" if it repeats.',
        exchange_network: 'The token exchange with Clover could not be reached (step: exchange). Try again; mention code "exchange_network" if it repeats.',
        db_error: 'Your token arrived but saving it failed (step: save). Mention code "db_error" if it repeats.',
      }
      setCloverBanner(
        messages[result] ??
          (result.startsWith('exchange_')
            ? `Clover rejected the token exchange (step: exchange, status ${result.replace('exchange_', '')}). Mention code "${result}" if it repeats.`
            : `The Clover connection didn't complete (code: ${result}). Mention the code if it repeats.`)
      )
    }
  }, [])

  async function saveClover() {
    if (!restaurantId) return
    setStatus('saving')
    const payload = {
      restaurant_id: restaurantId,
      clover_merchant_id: merchantId.trim() || null,
      clover_api_key: apiKey.startsWith('••') ? undefined : (apiKey.trim() || null),
    }
    const { error } = await supabase
      .from('restaurant_settings')
      .upsert(payload, { onConflict: 'restaurant_id' })
    if (error) { setStatus('error'); return }
    setConnected(!!(merchantId.trim() && apiKey.trim()))
    setStatus('saved')
    setTimeout(() => setStatus('idle'), 3000)
  }

  // Billing: server configuration + whether this restaurant already
  // has a subscription, plus the banner after a checkout round-trip.
  useEffect(() => {
    if (!restaurantId) return
    fetch(`/api/billing/status?restaurant_id=${restaurantId}`)
      .then((r) => r.json())
      .then((j) => {
        setBillingConfigured(!!j.configured)
        setHasSubscription(!!j.has_subscription)
      })
      .catch(() => {})
    fetch(`/api/billing/invoices?restaurant_id=${restaurantId}`)
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.invoices)) setBillingHistory(j)
      })
      .catch(() => {})
    const b = new URLSearchParams(window.location.search).get('billing')
    if (b === 'success') setBillingMsg('Subscription started — welcome aboard.')
    if (b === 'cancelled') setBillingMsg('Checkout was cancelled. Nothing was charged.')
  }, [restaurantId])

  async function startCheckout() {
    if (!restaurantId) return
    setBillingBusy(true)
    setBillingMsg(null)
    try {
      const resp = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: restaurantId }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok || !json.url)
        throw new Error(json.error || `Checkout failed (HTTP ${resp.status})`)
      window.location.href = json.url
    } catch (e: any) {
      setBillingMsg(e.message || 'Checkout failed')
      setBillingBusy(false)
    }
  }

  async function openPortal() {
    if (!restaurantId) return
    setBillingBusy(true)
    setBillingMsg(null)
    try {
      const resp = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: restaurantId }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok || !json.url)
        throw new Error(json.error || `Portal failed (HTTP ${resp.status})`)
      window.location.href = json.url
    } catch (e: any) {
      setBillingMsg(e.message || 'Portal failed')
      setBillingBusy(false)
    }
  }

  // Email scan: server configuration + this restaurant's connection.
  useEffect(() => {
    if (!restaurantId) return
    fetch(`/api/email/status?restaurant_id=${restaurantId}`)
      .then((r) => r.json())
      .then((j) => {
        setMailConfigured(!!j.configured)
        setMailConnected(!!j.connected)
        setMailEmail(j.email || '')
        setMailLastScan(j.last_scan_at ?? null)
      })
      .catch(() => {})
    const b = new URLSearchParams(window.location.search).get('email')
    const messages: Record<string, string> = {
      connected: 'Email connected. Hit "Scan now" to pull in supplier invoices right away.',
      migration_needed: 'Almost there — the email tables need a quick database update first (migration 013).',
      no_encryption_key: "Email connect needs the server's encryption key set up first.",
      not_configured: 'Email connect is not switched on yet.',
      failed: "The email connection didn't complete. Try again.",
    }
    if (b && messages[b]) setMailBanner(messages[b])
  }, [restaurantId])

  // WhatsApp intake: configuration probe + registered numbers.
  useEffect(() => {
    if (!restaurantId) return
    fetch('/api/whatsapp/status')
      .then((r) => r.json())
      .then((j) => {
        setWaConfigured(!!j.configured)
        setWaIntakeNumber(j.intake_number ?? null)
      })
      .catch(() => {})
    supabase
      .from('whatsapp_senders')
      .select('id, phone, label, kind')
      .eq('restaurant_id', restaurantId)
      .order('created_at')
      .then(({ data, error }) => {
        if (error) {
          if (error.message.includes('whatsapp_senders')) {
            setWaMsg('Almost there — the WhatsApp tables need a quick database update first (migration 019).')
          }
          return
        }
        setWaNumbers((data as WaSender[]) ?? [])
      })
  }, [restaurantId])

  async function addWaNumber() {
    if (!restaurantId) return
    const digits = waNewPhone.replace(/\D/g, '')
    const phone = digits.length === 10 ? `1${digits}` : digits
    if (phone.length < 11 || phone.length > 15) {
      setWaMsg('Enter the full number with country code — for a US number, 10 digits is enough.')
      return
    }
    setWaBusy(true)
    setWaMsg(null)
    const { data, error } = await supabase
      .from('whatsapp_senders')
      .insert({
        restaurant_id: restaurantId,
        phone,
        label: waNewLabel.trim() || null,
        kind: waNewKind,
      })
      .select('id, phone, label, kind')
      .single()
    setWaBusy(false)
    if (error) {
      setWaMsg(
        error.message.includes('whatsapp_senders_phone_key') || error.code === '23505'
          ? 'That number is already registered — a phone number can only file into one restaurant.'
          : error.message
      )
      return
    }
    if (data) setWaNumbers((prev) => [...prev, data as WaSender])
    setWaNewPhone('')
    setWaNewLabel('')
    setWaMsg('Number registered. Receipts sent from it will land in Review.')
  }

  async function removeWaNumber(id: string) {
    const { error } = await supabase.from('whatsapp_senders').delete().eq('id', id)
    if (error) {
      setWaMsg(error.message)
      return
    }
    setWaNumbers((prev) => prev.filter((n) => n.id !== id))
  }

  async function scanNow() {
    if (!restaurantId) return
    setMailScanning(true)
    setMailMsg(null)
    try {
      // Runs through the activity store so the scan shows in the
      // right-side Activity panel and survives navigation.
      const json = await activity.startEmailScan()
      setMailLastScan(new Date().toISOString())
      setMailMsg(
        `Scan complete: ${json.imported} invoice${json.imported === 1 ? '' : 's'} imported` +
          (json.flagged ? `, ${json.flagged} sent to review` : '') +
          (json.errors?.length ? ` (${json.errors.length} couldn't be read)` : '') +
          '.'
      )
    } catch (e: any) {
      setMailMsg(e.message || 'Scan failed')
    }
    setMailScanning(false)
  }

  async function disconnectMail() {
    if (!restaurantId) return
    await fetch('/api/email/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurant_id: restaurantId }),
    }).catch(() => {})
    setMailConnected(false)
    setMailEmail('')
    setMailLastScan(null)
    setMailMsg('Email disconnected.')
  }

  async function disconnectClover() {
    if (!restaurantId) return
    if (!window.confirm('Disconnect Clover? Sales sync will stop until you reconnect.')) return
    setDisconnecting(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Sign in required')
      const resp = await fetch('/api/clover/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ restaurant_id: restaurantId }),
      })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error || 'Disconnect failed')
      window.location.reload()
    } catch (e) {
      setCloverBanner(e instanceof Error ? e.message : 'Disconnect failed')
      setDisconnecting(false)
    }
  }

  async function triggerSync() {
    setSyncing(true); setSyncMsg('')
    try {
      // Via the activity store: visible in the Activity panel too.
      const json = await activity.startCloverSync()
      setSyncMsg(
        `Synced ${json.count} sales records${json.auth_source ? ` (via ${json.auth_source} token)` : ''}.${
          json.expand_used && json.expand_used !== 'lineItems,discounts,refunds,orderType,payments'
            ? ` Limited fields for this app: ${json.expand_used}`
            : ''
        }${
          json.fields_missing && json.fields_missing.length > 0
            ? ` Clover returned no ${json.fields_missing.join(' or ')} data — the app's token can't read those fields. Grant Orders + Payments read in the Clover developer dashboard, then Reconnect above and sync again.`
            : ''
        }`
      )
    } catch (e: any) {
      setSyncMsg(e.message || 'Sync failed')
    }
    setSyncing(false)
  }

  // Business cards — load on restaurant switch
  useEffect(() => {
    if (!restaurantId) { setCards([]); return }
    setCardErr(null)
    supabase
      .from('restaurants')
      .select('known_owner_cards')
      .eq('id', restaurantId)
      .single()
      .then(({ data }) => {
        setCards((data?.known_owner_cards as string[]) ?? [])
      })
  }, [restaurantId])

  function addCard() {
    const c = newCard.trim()
    if (!/^\d{4}$/.test(c)) { setCardErr('Enter exactly 4 digits.'); return }
    if (cards.includes(c)) { setCardErr('That card is already listed.'); setNewCard(''); return }
    setCards([...cards, c])
    setNewCard('')
    setCardErr(null)
  }

  function removeCard(c: string) {
    setCards(cards.filter(x => x !== c))
  }

  async function saveCards() {
    if (!restaurantId) return
    setCardStatus('saving'); setCardErr(null)
    const { error } = await supabase.rpc('update_my_restaurant_cards', {
      p_restaurant_id: restaurantId,
      p_cards: cards,
    })
    if (error) {
      setCardStatus('error')
      setCardErr(error.message || 'Save failed')
      return
    }
    setCardStatus('saved')
    setTimeout(() => setCardStatus('idle'), 3000)
  }

  // Pre-flight counts for the Danger Zone — refreshes on restaurant switch.
  useEffect(() => {
    if (!restaurantId) { setCounts(null); return }
    setConfirmText(''); setDeleteErr(null)
    let cancelled = false
    ;(async () => {
      const [files, headers, lines, sales, members] = await Promise.all([
        supabase.from('invoice_files').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
        supabase.from('invoice_headers').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
        supabase.from('invoice_lines').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
        supabase.from('pos_sales').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
        supabase.from('user_restaurants').select('user_id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
      ])
      if (cancelled) return
      setCounts({
        invoice_files: files.count ?? 0,
        invoice_headers: headers.count ?? 0,
        invoice_lines: lines.count ?? 0,
        pos_sales: sales.count ?? 0,
        members: members.count ?? 0,
      })
    })()
    return () => { cancelled = true }
  }, [restaurantId])

  async function handleDelete() {
    if (!restaurantId) return
    if (confirmText !== restaurantName) {
      setDeleteErr('Type the restaurant name exactly to confirm.')
      return
    }
    setDeleting(true); setDeleteErr(null)
    try {
      await deleteRestaurant(restaurantId)
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  async function handleDeleteAccount() {
    if (
      !accountEmail ||
      confirmEmailText.trim().toLowerCase() !== accountEmail.toLowerCase()
    ) {
      setDeleteAccountErr('Type your account email exactly to confirm.')
      return
    }
    setDeletingAccount(true); setDeleteAccountErr(null)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Sign in required')
      const resp = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirm_email: confirmEmailText.trim() }),
      })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error || 'Account deletion failed')
      await supabase.auth.signOut()
      window.location.href = '/login'
    } catch (e) {
      setDeleteAccountErr(e instanceof Error ? e.message : 'Account deletion failed')
      setDeletingAccount(false)
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px] text-ink mb-1">Settings</h1>
      <p className="text-ink-muted text-sm mb-8">Manage integrations and connections.</p>

      <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-6 mb-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
            <Link2 size={18} className="text-green-600" />
          </div>
          <div>
            <div className="font-display text-[16px] font-bold text-ink flex items-center gap-2">
              Clover POS
              {connected && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle size={10} /> Connected</span>}
            </div>
            <div className="text-sm text-ink-muted">Pull sales data to enable wastage tracking</div>
          </div>
        </div>

        {cloverBanner && (
          <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {cloverBanner}
          </div>
        )}

        {oauthConnected ? (
          <div className="mb-5 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            <p>
              Connected with Clover — nothing to copy or manage. Your access token is stored
              encrypted, and sales sync uses it automatically.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href={`/api/clover/connect?restaurant_id=${restaurantId}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-pop px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-pop-hover transition"
              >
                <Link2 size={13} /> Reconnect
              </a>
              <button
                onClick={disconnectClover}
                disabled={disconnecting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-cream-surface px-3.5 py-1.5 text-[13px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition"
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
              <span className="text-xs text-green-600">
                Reconnect after changing the app&apos;s permissions in Clover — the fresh
                token picks them up.
              </span>
            </div>
          </div>
        ) : oauthConfigured ? (
          <div className="mb-5">
            <a
              href={`/api/clover/connect?restaurant_id=${restaurantId}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-pop text-white rounded-lg text-sm font-medium hover:bg-pop-hover transition"
            >
              <Link2 size={15} /> Connect with Clover{oauthEnv === 'sandbox' ? ' (sandbox)' : ''}
            </a>
            <p className="text-xs text-ink-muted mt-2">
              Recommended — you approve access on Clover&apos;s own site, no token copying.
              Or paste a token manually below.
            </p>
          </div>
        ) : null}

        <div className="space-y-4 mb-5">
          <div>
            <label className="block text-xs font-medium text-ink-3 mb-1.5 uppercase tracking-wide">Merchant ID</label>
            <input
              value={merchantId}
              onChange={e => setMerchantId(e.target.value)}
              placeholder="e.g. ABC12DEFGHIJK"
              className="w-full rounded-[9px] border border-ink/[0.16] bg-cream-surface px-3 py-2 text-sm text-ink-2 outline-none focus:border-terracotta"
            />
            <p className="text-xs text-ink-muted mt-1">Found in Clover Dashboard → Account → About</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-3 mb-1.5 uppercase tracking-wide flex items-center gap-1"><Key size={11} /> API Key</label>
            <input
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              type="password"
              placeholder="Clover API token"
              className="w-full rounded-[9px] border border-ink/[0.16] bg-cream-surface px-3 py-2 text-sm text-ink-2 outline-none focus:border-terracotta"
            />
            <p className="text-xs text-ink-muted mt-1">Clover Dashboard → Setup → API Tokens → Create Token</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={saveClover} disabled={status === 'saving'}
            className="px-5 py-2 bg-pop text-white rounded-lg text-sm font-medium hover:bg-pop-hover disabled:opacity-50 transition">
            {status === 'saving' ? 'Saving...' : 'Save'}
          </button>
          {status === 'saved' && <span className="text-sm text-green-600 flex items-center gap-1"><CheckCircle size={14} /> Saved</span>}
          {status === 'error' && <span className="text-sm text-red-500 flex items-center gap-1"><AlertCircle size={14} /> Error saving</span>}
        </div>

        {connected && (
          <div className="mt-5 pt-5 border-t">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-ink">Sync Sales Data</div>
                <div className="text-xs text-ink-muted mt-0.5">Pull last 30 days of sales from Clover</div>
              </div>
              <button onClick={triggerSync} disabled={syncing}
                className="px-4 py-2 bg-cream-surface border border-ink/[0.14] rounded-[9px] text-sm text-ink-3 hover:bg-cream-surface-alt disabled:opacity-50 transition">
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>
            {syncMsg && <p className="text-sm text-ink-3 mt-2">{syncMsg}</p>}
          </div>
        )}
      </div>

      <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-6 mb-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-pop/10 rounded-xl flex items-center justify-center">
            <CreditCard size={18} className="text-pop" />
          </div>
          <div>
            <div className="font-display text-[16px] font-bold text-ink flex items-center gap-2">
              Billing
              {(() => {
                const s = current?.subscription_status ?? 'trialing'
                const label = s.replace('_', ' ')
                const cls =
                  s === 'active'
                    ? 'bg-green-100 text-green-700'
                    : s === 'past_due'
                      ? 'bg-red-100 text-red-700'
                      : s === 'canceled'
                        ? 'bg-ink/[0.06] text-ink-3'
                        : 'bg-amber-100 text-amber-700'
                return (
                  <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${cls}`}>
                    {label}
                  </span>
                )
              })()}
            </div>
            <div className="text-sm text-ink-muted">
              {current?.trial_ends_at
                ? `Free trial ${new Date(current.trial_ends_at) > new Date() ? 'ends' : 'ended'} ${new Date(current.trial_ends_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · per-location monthly plan`
                : 'Per-location monthly plan'}
            </div>
          </div>
        </div>

        {billingMsg && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {billingMsg}
          </div>
        )}

        {!billingConfigured ? (
          <p className="text-sm text-ink-muted">Payments aren&apos;t switched on yet.</p>
        ) : hasSubscription ? (
          <button
            onClick={openPortal}
            disabled={billingBusy}
            className="px-5 py-2 bg-cream-surface border border-ink/[0.14] rounded-[9px] text-sm font-medium text-ink-2 hover:bg-cream-surface-alt disabled:opacity-50 transition"
          >
            {billingBusy ? 'Opening…' : 'Manage billing'}
          </button>
        ) : (
          <button
            onClick={startCheckout}
            disabled={billingBusy}
            className="px-5 py-2 bg-pop text-white rounded-lg text-sm font-medium hover:bg-pop-hover disabled:opacity-50 transition"
          >
            {billingBusy ? 'Opening checkout…' : 'Subscribe'}
          </button>
        )}
        {billingConfigured && (
          <p className="text-xs text-ink-muted mt-3">
            Secure checkout and card management run on Stripe. Cancel anytime from the billing portal.
          </p>
        )}

        {billingConfigured && billingHistory && (
          <div className="mt-6 border-t pt-5">
            <div className="text-sm font-medium text-ink-2 mb-2">Renewal</div>
            {billingHistory.subscription ? (
              <p className="text-sm text-ink-muted mb-5">
                {billingHistory.subscription.status === 'trialing' &&
                billingHistory.subscription.trial_end
                  ? `Free trial ends ${new Date(billingHistory.subscription.trial_end * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} — first charge of $${((billingHistory.subscription.amount ?? 9900) / 100).toFixed(2)} then, renews monthly.`
                  : billingHistory.subscription.cancel_at_period_end
                    ? `Cancels on ${new Date(billingHistory.subscription.current_period_end * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} — no further charges.`
                    : `Renews ${new Date(billingHistory.subscription.current_period_end * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · $${((billingHistory.subscription.amount ?? 9900) / 100).toFixed(2)}/month.`}
              </p>
            ) : (
              <p className="text-sm text-ink-muted mb-5">No subscription yet.</p>
            )}

            <div className="text-sm font-medium text-ink-2 mb-2">Payment history</div>
            {billingHistory.invoices.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No invoices yet — history appears after your first charge.
              </p>
            ) : (
              <div className="divide-y">
                {billingHistory.invoices.map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-ink-muted">
                      {new Date(inv.created * 1000).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}{' '}
                      · {inv.number ?? 'Invoice'}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="capitalize text-ink-muted">{inv.status}</span>
                      <span className="font-medium text-ink-2">
                        ${(((inv.amount_paid || inv.total) ?? 0) / 100).toFixed(2)}
                      </span>
                      {inv.hosted_invoice_url && (
                        <a
                          href={inv.hosted_invoice_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-pop hover:underline"
                        >
                          View
                        </a>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-6 mb-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-pop/10 rounded-xl flex items-center justify-center">
            <Mail size={18} className="text-pop" />
          </div>
          <div>
            <div className="font-display text-[16px] font-bold text-ink flex items-center gap-2">
              Email invoices
              {mailConnected && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle size={10} /> Connected</span>}
            </div>
            <div className="text-sm text-ink-muted">We scan your inbox for supplier invoices and import them for you</div>
          </div>
        </div>

        {mailBanner && (
          <div className="flex items-start gap-2 border border-ink/[0.08] bg-cream-surface-alt text-ink-2 text-sm rounded-lg px-3 py-2 mb-4">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{mailBanner}</span>
          </div>
        )}

        <p className="text-sm text-ink-3 mb-4">
          Lost a paper receipt? If your supplier emailed a copy — or sends invoices by
          email from their app — connecting your inbox lets getinvoiceIQ find and import them
          automatically. We only import emails that look like supplier invoices
          (known supplier senders, or attachments named like an invoice). Access is
          read-only: we never send, move, or delete your mail.
        </p>

        {mailConnected ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">
              Scanning <span className="font-medium">{mailEmail}</span>
              {mailLastScan
                ? ` · last scan ${new Date(mailLastScan).toLocaleString()}`
                : ' · not scanned yet'}
              . New invoices are also picked up automatically once a day.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={scanNow}
                disabled={mailScanning}
                className="bg-ink text-white text-sm font-medium px-4 py-2 rounded-[9px] hover:bg-black disabled:opacity-50"
              >
                {mailScanning ? 'Scanning…' : 'Scan now'}
              </button>
              <button
                onClick={disconnectMail}
                className="text-sm font-medium px-4 py-2 rounded-lg border border-ink/[0.14] bg-cream-surface text-ink-3 hover:bg-cream-surface-alt"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : mailConfigured ? (
          <a
            href={`/api/email/connect?restaurant_id=${restaurantId ?? ''}`}
            className="inline-block bg-ink text-white text-sm font-medium px-4 py-2 rounded-[9px] hover:bg-black"
          >
            Connect Gmail
          </a>
        ) : (
          <p className="text-sm text-ink-muted">
            Email scanning isn’t switched on yet — it will appear here once it’s ready.
          </p>
        )}
        {mailMsg && <p className="text-sm text-ink-3 mt-3">{mailMsg}</p>}
      </div>

      <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-6 mb-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
            <MessageCircle size={18} className="text-green-600" />
          </div>
          <div>
            <div className="font-display text-[16px] font-bold text-ink flex items-center gap-2">
              WhatsApp invoices
              {waConfigured && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle size={10} /> Live</span>}
            </div>
            <div className="text-sm text-ink-muted">Forward receipt photos on WhatsApp — they file themselves into Review</div>
          </div>
        </div>

        <p className="text-sm text-ink-3 mb-4">
          Suppliers send invoices on WhatsApp; paper gets lost. Register the phone numbers
          of the people who handle receipts — owner, manager, whoever buys — and any invoice
          photo or PDF they forward to the getinvoiceIQ WhatsApp number is read automatically
          and placed in your Review queue. Like email, WhatsApp is an outside channel:
          nothing counts until you approve it.
        </p>

        {!waConfigured ? (
          <p className="text-sm text-ink-muted mb-4">
            WhatsApp intake is not switched on yet — you can register numbers now, and they
            will start working the moment it goes live.
          </p>
        ) : waIntakeNumber ? (
          <p className="text-sm text-ink-2 mb-4">
            Send receipts to <span className="font-medium">{waIntakeNumber}</span> from a
            registered number.
          </p>
        ) : null}

        {waNumbers.length > 0 && (
          <div className="space-y-2 mb-4">
            {waNumbers.map((n) => (
              <div key={n.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink/[0.08] bg-cream-surface-alt px-3 py-2">
                <div className="text-sm">
                  <span className="font-medium text-ink">+{n.phone}</span>
                  {n.label && <span className="text-ink-muted"> · {n.label}</span>}
                  <span className="ml-2 text-xs bg-cream-surface border border-ink/[0.12] text-ink-muted px-2 py-0.5 rounded-full">{n.kind}</span>
                </div>
                <button
                  onClick={() => removeWaNumber(n.id)}
                  aria-label={`Remove +${n.phone}`}
                  className="text-ink-muted hover:text-red-500"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="tel"
            value={waNewPhone}
            onChange={(e) => setWaNewPhone(e.target.value)}
            placeholder="Phone number, e.g. (314) 555-0123"
            className="min-w-0 flex-1 rounded-[9px] border border-ink/[0.16] bg-cream-surface px-3 py-2 text-sm outline-none focus:border-terracotta"
          />
          <input
            type="text"
            value={waNewLabel}
            onChange={(e) => setWaNewLabel(e.target.value)}
            placeholder="Whose number? (name)"
            className="min-w-0 flex-1 rounded-[9px] border border-ink/[0.16] bg-cream-surface px-3 py-2 text-sm outline-none focus:border-terracotta"
          />
          <select
            value={waNewKind}
            onChange={(e) => setWaNewKind(e.target.value as 'staff' | 'supplier')}
            className="shrink-0 rounded-[9px] border border-ink/[0.16] bg-cream-surface px-3 py-2 text-sm outline-none focus:border-terracotta"
          >
            <option value="staff">Staff</option>
            <option value="supplier">Supplier</option>
          </select>
          <button
            onClick={addWaNumber}
            disabled={waBusy}
            className="shrink-0 whitespace-nowrap bg-ink text-white text-sm font-medium px-4 py-2 rounded-[9px] hover:bg-black disabled:opacity-50"
          >
            {waBusy ? 'Adding…' : 'Add number'}
          </button>
        </div>
        {waMsg && <p className="text-sm text-ink-3 mt-3">{waMsg}</p>}
      </div>

      <div className="bg-cream-surface rounded-[14px] border border-ink/[0.08] p-6 mb-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-pop/10 rounded-xl flex items-center justify-center">
            <CreditCard size={18} className="text-pop" />
          </div>
          <div>
            <div className="font-semibold text-ink">Business Cards</div>
            <div className="text-sm text-ink-muted">Last 4 digits of the cards this restaurant pays with. Invoices paid on other cards are skipped as personal.</div>
          </div>
        </div>

        {cards.length > 0 ? (
          <div className="flex flex-wrap gap-2 mb-4">
            {cards.map(c => (
              <span key={c} className="inline-flex items-center gap-1.5 bg-cream text-ink-2 text-sm rounded-full pl-3 pr-1.5 py-1 font-medium">
                •••• {c}
                <button onClick={() => removeCard(c)} className="w-5 h-5 rounded-full hover:bg-ink/[0.08] flex items-center justify-center text-ink-muted hover:text-ink transition">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div className="text-sm text-ink-muted mb-4">No cards yet. Add the last 4 digits of each business card below.</div>
        )}

        <div className="flex items-center gap-2 mb-4">
          <input
            value={newCard}
            onChange={e => { setNewCard(e.target.value.replace(/\D/g, '').slice(0, 4)); setCardErr(null) }}
            onKeyDown={e => { if (e.key === 'Enter') addCard() }}
            placeholder="1234"
            inputMode="numeric"
            maxLength={4}
            className="w-24 rounded-[9px] border border-ink/[0.16] bg-cream-surface px-3 py-2 text-sm text-ink-2 outline-none focus:border-terracotta tracking-widest"
          />
          <button onClick={addCard}
            className="px-4 py-2 bg-cream-surface border border-ink/[0.14] rounded-[9px] text-sm text-ink-3 hover:bg-cream-surface-alt transition">
            Add card
          </button>
        </div>

        {cardErr && (
          <div className="bg-red-50 text-red-700 text-sm p-2.5 rounded mb-3 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            {cardErr}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button onClick={saveCards} disabled={cardStatus === 'saving'}
            className="px-5 py-2 bg-pop text-white rounded-lg text-sm font-medium hover:bg-pop-hover disabled:opacity-50 transition">
            {cardStatus === 'saving' ? 'Saving...' : 'Save cards'}
          </button>
          {cardStatus === 'saved' && <span className="text-sm text-green-600 flex items-center gap-1"><CheckCircle size={14} /> Saved</span>}
          {cardStatus === 'error' && <span className="text-sm text-red-500 flex items-center gap-1"><AlertCircle size={14} /> Error saving</span>}
        </div>
      </div>

      <div className="bg-cream-surface-alt rounded-[14px] border border-dashed border-ink/[0.16] p-6 text-center text-ink-muted mb-6">
        <div className="text-sm font-medium mb-1">More integrations coming soon</div>
        <div className="text-xs">Gordon Food Service · Costco · Sysco</div>
      </div>

      <div className="bg-cream-surface rounded-[14px] border border-red-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
            <AlertTriangle size={18} className="text-red-600" />
          </div>
          <div>
            <div className="font-semibold text-red-700">Danger Zone</div>
            <div className="text-sm text-ink-muted">Permanent actions. Read carefully.</div>
          </div>
        </div>

        <div className="border border-red-100 rounded-lg p-4 bg-red-50/50">
          <div className="font-display font-bold text-ink mb-1">Delete this restaurant</div>
          <div className="text-sm text-ink-3 mb-3">
            Permanently delete <span className="font-semibold text-ink">{restaurantName || '—'}</span> and everything attached to it. This cannot be undone.
          </div>

          {counts && (
            <div className="text-xs text-ink-3 bg-cream-surface border border-red-100 rounded-[9px] p-3 mb-3 space-y-0.5">
              <div className="font-medium text-ink mb-1">Will permanently delete:</div>
              <div>· {counts.invoice_files.toLocaleString()} invoice file(s)</div>
              <div>· {counts.invoice_headers.toLocaleString()} invoice(s)</div>
              <div>· {counts.invoice_lines.toLocaleString()} line item(s)</div>
              <div>· {counts.pos_sales.toLocaleString()} POS sales record(s)</div>
              <div>· {counts.members.toLocaleString()} team member link(s)</div>
              <div className="text-ink-muted mt-1">Plus: vendors config, invites, recipes, calibrations, Clover settings.</div>
            </div>
          )}

          <label className="block text-xs font-medium text-ink-3 mb-1.5 uppercase tracking-wide">
            Type <span className="font-semibold text-ink">{restaurantName}</span> to confirm
          </label>
          <input
            value={confirmText}
            onChange={(e) => { setConfirmText(e.target.value); setDeleteErr(null) }}
            placeholder={restaurantName}
            className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm text-ink-2 focus:outline-none focus:border-red-400 mb-3"
          />

          {deleteErr && (
            <div className="bg-red-100 text-red-700 text-sm p-2.5 rounded mb-3 flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {deleteErr}
            </div>
          )}

          <button
            onClick={handleDelete}
            disabled={deleting || confirmText !== restaurantName}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <Trash2 size={14} />
            {deleting ? 'Deleting…' : 'Delete restaurant permanently'}
          </button>
          <p className="text-xs text-ink-muted mt-2">
            Owner role required. Soft alternative: ask Supabase admin to set <code className="font-mono">is_active=false</code>.
          </p>
        </div>

        <div className="border border-red-100 rounded-lg p-4 bg-red-50/50 mt-4">
          <div className="font-display font-bold text-ink mb-1">Delete your account</div>
          <div className="text-sm text-ink-3 mb-3">
            Permanently delete your getinvoiceIQ account
            {accountEmail && (
              <>
                {' '}(<span className="font-semibold text-ink">{accountEmail}</span>)
              </>
            )}
            . Every restaurant you <span className="font-semibold text-ink">own</span> is
            deleted with all of its invoices, sales and recipes; you will be removed from any
            restaurant you only belong to. This cannot be undone.
          </div>

          <label className="block text-xs font-medium text-ink-3 mb-1.5 uppercase tracking-wide">
            Type your account email to confirm
          </label>
          <input
            value={confirmEmailText}
            onChange={(e) => { setConfirmEmailText(e.target.value); setDeleteAccountErr(null) }}
            placeholder={accountEmail ?? 'you@example.com'}
            className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm text-ink-2 focus:outline-none focus:border-red-400 mb-3"
          />

          {deleteAccountErr && (
            <div className="bg-red-100 text-red-700 text-sm p-2.5 rounded mb-3 flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {deleteAccountErr}
            </div>
          )}

          <button
            onClick={handleDeleteAccount}
            disabled={
              deletingAccount ||
              !accountEmail ||
              confirmEmailText.trim().toLowerCase() !== accountEmail.toLowerCase()
            }
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <Trash2 size={14} />
            {deletingAccount ? 'Deleting…' : 'Delete account permanently'}
          </button>
        </div>
      </div>
    </div>
  )
}