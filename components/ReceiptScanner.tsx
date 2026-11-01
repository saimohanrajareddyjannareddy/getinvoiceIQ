'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Flashlight, FlashlightOff, X } from 'lucide-react'

/*
 * Guided receipt scanner. Opens the camera and watches the live
 * feed (analyzed on a small canvas at ~5 fps, never sent
 * anywhere). When the shot is sharp, well-lit, glare-free, steady
 * AND actually contains a receipt, the scanner LOCKS ON and turns
 * the shutter green — a human tap takes the photo at full
 * resolution. The scanner never fires on its own: Sai's first
 * field test (2026-10-29) showed the old full-auto version happily
 * photographing a blank wall, because a wall passes the quality
 * gates. Two fixes came out of that test:
 *  - presence gate: enough strong edges (text/lines) must exist in
 *    the guide-frame region — a wall, counter, or ceiling has
 *    almost none, so it can never lock on.
 *  - human confirm: lock-on only ARMS the shutter; the person
 *    taps to capture. No tap, no photo.
 * Thresholds are heuristics — adjust if real-world shots misbehave.
 *
 * Quality gates:
 *  - brightness: mean luminance too low = too dark
 *  - glare: share of blown-out (near-white) pixels too high
 *  - presence: share of strong-edge pixels inside the frame region
 *  - sharpness: variance of the Laplacian (classic blur measure)
 *  - steadiness: frame-to-frame difference (hand shake / motion)
 */

const ANALYSIS_WIDTH = 320
const TOO_DARK = 45
const GLARE_MAX = 0.1
const SHARP_MIN = 90
const STEADY_MAX = 7
const HOLD_CHECKS = 4 // 4 consecutive good checks at 200 ms ≈ 0.8 s
const EDGE_ABS = 50 // |Laplacian| above this counts as a strong edge (text stroke)
const EDGE_MIN_SHARE = 0.008 // strong edges must cover ≥0.8% of the frame region — walls sit far below this

type ScanStatus = { msg: string; good: boolean; progress: number }

export default function ReceiptScanner({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const prevGrayRef = useRef<Float32Array | null>(null)
  const holdRef = useRef(0)
  const armedRef = useRef(false)
  const capturedRef = useRef(false)
  const [status, setStatus] = useState<ScanStatus>({
    msg: 'Starting camera…',
    good: false,
    progress: 0,
  })
  const [error, setError] = useState<string | null>(null)
  const [torchOn, setTorchOn] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined

    function stopTracks() {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }

    function analyze() {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < 2 || capturedRef.current) return
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return

      const w = ANALYSIS_WIDTH
      const h = Math.max(1, Math.round((ANALYSIS_WIDTH * video.videoHeight) / video.videoWidth))
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      ctx.drawImage(video, 0, 0, w, h)
      const { data } = ctx.getImageData(0, 0, w, h)

      const gray = new Float32Array(w * h)
      let lumSum = 0
      let clipped = 0
      for (let i = 0; i < w * h; i++) {
        const r = data[i * 4]
        const g = data[i * 4 + 1]
        const b = data[i * 4 + 2]
        const lum = 0.299 * r + 0.587 * g + 0.114 * b
        gray[i] = lum
        lumSum += lum
        if (lum > 250) clipped++
      }
      const meanLum = lumSum / (w * h)
      const glareShare = clipped / (w * h)

      // Sharpness: variance of the Laplacian over interior pixels.
      // Presence: strong-edge share inside the guide-frame region —
      // receipt text and lines are dense with strong edges; a blank
      // wall or counter scores near zero and can never lock on.
      const rx0 = Math.floor(w * 0.15)
      const rx1 = Math.floor(w * 0.85)
      const ry0 = Math.floor(h * 0.15)
      const ry1 = Math.floor(h * 0.85)
      let regionPixels = 0
      let strongEdges = 0
      let lapMean = 0
      const laps: number[] = []
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x
          const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]
          laps.push(lap)
          lapMean += lap
          if (x >= rx0 && x < rx1 && y >= ry0 && y < ry1) {
            regionPixels++
            if (Math.abs(lap) > EDGE_ABS) strongEdges++
          }
        }
      }
      lapMean /= laps.length
      let lapVar = 0
      for (const l of laps) lapVar += (l - lapMean) * (l - lapMean)
      lapVar /= laps.length
      const edgeShare = regionPixels > 0 ? strongEdges / regionPixels : 0

      // Steadiness: mean absolute difference vs the previous frame.
      let steadyDiff = Number.POSITIVE_INFINITY
      const prev = prevGrayRef.current
      if (prev && prev.length === gray.length) {
        let diffSum = 0
        for (let i = 0; i < gray.length; i += 4) diffSum += Math.abs(gray[i] - prev[i])
        steadyDiff = diffSum / (gray.length / 4)
      }
      prevGrayRef.current = gray

      let msg: string
      let good = false
      if (meanLum < TOO_DARK) msg = 'Too dark — find more light or turn on the flashlight'
      else if (glareShare > GLARE_MAX) msg = 'Glare — tilt the receipt slightly'
      else if (edgeShare < EDGE_MIN_SHARE) msg = 'No receipt in the frame — point at the receipt'
      else if (lapVar < SHARP_MIN) msg = 'Blurry — hold the phone still and let it focus'
      else if (steadyDiff > STEADY_MAX) msg = 'Keep it steady…'
      else {
        good = true
        msg = 'Perfect — hold it right there…'
      }

      if (good) {
        holdRef.current += 1
        const progress = Math.min(1, holdRef.current / HOLD_CHECKS)
        if (holdRef.current >= HOLD_CHECKS) {
          // Locked on — but do NOT capture. Arm the shutter and let
          // the human confirm with a tap (Sai's requirement after
          // the wall test). No tap, no photo.
          if (!armedRef.current) {
            armedRef.current = true
            setArmed(true)
          }
          setStatus({ msg: 'Locked on — tap the green button to take the photo', good: true, progress: 1 })
        } else {
          setStatus({ msg, good, progress })
        }
      } else {
        holdRef.current = 0
        if (armedRef.current) {
          armedRef.current = false
          setArmed(false)
        }
        setStatus({ msg, good, progress: 0 })
      }
    }

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean }
        if (caps.torch) setTorchAvailable(true)
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => {})
        }
        setStatus({ msg: 'Point at the receipt and fill the frame', good: false, progress: 0 })
        timer = setInterval(analyze, 200)
      } catch {
        if (!cancelled) {
          setError(
            'Camera unavailable. Check the browser permission, or use the regular file upload instead.'
          )
        }
      }
    }

    start()
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      stopTracks()
    }
     
  }, [])

  function manualCapture() {
    const video = videoRef.current
    if (!video || capturedRef.current) return
    capturedRef.current = true
    const shot = document.createElement('canvas')
    shot.width = video.videoWidth
    shot.height = video.videoHeight
    const sctx = shot.getContext('2d')
    if (!sctx) return
    sctx.drawImage(video, 0, 0)
    shot.toBlob(
      (blob) => {
        if (!blob) return
        const file = new File([blob], `receipt-scan-${Date.now()}.jpg`, {
          type: 'image/jpeg',
        })
        streamRef.current?.getTracks().forEach((t) => t.stop())
        onCapture(file)
      },
      'image/jpeg',
      0.92
    )
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      })
      setTorchOn(next)
    } catch {
      // Torch unsupported on this device/browser — ignore.
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />
        {/* Guide frame */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className={`w-[78%] max-w-sm aspect-[3/4] rounded-lg border-2 transition-colors ${
              armed || status.good ? 'border-green-400' : 'border-white/70'
            }`}
            style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }}
          />
        </div>
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center"
          aria-label="Close scanner"
        >
          <X size={18} />
        </button>
        {/* Status pill */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 w-max max-w-[92%]">
          <div
            className={`text-sm text-white px-4 py-2 rounded-full text-center ${
              status.good ? 'bg-green-600/90' : 'bg-black/60'
            }`}
          >
            {error ?? status.msg}
          </div>
          {status.progress > 0 && (
            <div className="h-1 bg-white/25 rounded mt-2 overflow-hidden">
              <div
                className="h-full bg-green-400 transition-all"
                style={{ width: `${status.progress * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>
      <div className="bg-black px-6 py-5 flex items-center justify-between">
        <div className="w-12">
          {torchAvailable && (
            <button
              onClick={toggleTorch}
              className="w-11 h-11 rounded-full bg-white/15 text-white flex items-center justify-center"
              aria-label="Toggle flashlight"
            >
              {torchOn ? <Flashlight size={19} /> : <FlashlightOff size={19} />}
            </button>
          )}
        </div>
        <button
          onClick={manualCapture}
          disabled={!!error}
          className={`w-16 h-16 rounded-full flex items-center justify-center disabled:opacity-40 transition-colors ${
            armed ? 'bg-green-500 animate-pulse' : 'bg-white'
          }`}
          aria-label={armed ? 'Take the photo' : 'Take photo now'}
        >
          {armed ? (
            <Check size={30} className="text-white" />
          ) : (
            <Camera size={26} className="text-gray-900" />
          )}
        </button>
        <div className="w-12 text-right">
          <button onClick={onClose} className="text-white/80 text-sm">
            Cancel
          </button>
        </div>
      </div>
      <p className="bg-black text-white/50 text-xs text-center pb-4 px-6">
        The scanner locks on when it sees a sharp, bright, steady receipt — then you tap the green button to take the photo. It never fires on its own.
      </p>
    </div>
  )
}
