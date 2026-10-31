'use client';

import { useEffect, useRef, useState } from 'react';
import { btn } from '@/components/ui';

const MAX_WIDTH = 640;

/** Shrinks a photo to at most 640px wide as a JPEG (a selfie is ~40–80 KB). */
async function toJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const scale = Math.min(1, MAX_WIDTH / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not take the photo'))), 'image/jpeg', 0.82));
}

/**
 * Takes a selfie with the front camera. If the camera can't be used (no permission,
 * no camera, an in-app browser), it falls back to the phone's own camera picker.
 */
export function SelfieCamera({ title, onCapture, onCancel }: { title: string; onCapture: (photo: Blob) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [stream, setStream] = useState<MediaStream>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live: MediaStream | undefined;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setFailed(true);
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        live = s;
        setStream(s);
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      live?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  async function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    setBusy(true);
    try {
      onCapture(await toJpeg(v, v.videoWidth, v.videoHeight));
    } finally {
      setBusy(false);
    }
  }

  async function fromFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      onCapture(await toJpeg(bitmap, bitmap.width, bitmap.height));
    } catch {
      onCapture(file);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-gray-900/60 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-sm animate-pop rounded-3xl bg-white p-5 shadow-lg">
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {!failed ? (
          <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-gray-900">
            {/* Mirrored like a mirror; the saved photo isn't. */}
            <video ref={video} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
            {!stream && <p className="absolute inset-0 grid place-items-center text-sm text-gray-300">Starting the camera…</p>}
          </div>
        ) : (
          <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
            The camera isn&apos;t available here. Allow camera access in your browser, or take a photo with your phone&apos;s camera instead.
          </p>
        )}
        <p className="mt-2 text-xs text-gray-500">Your selfie is kept for 30 days. You and your managers can see it.</p>
        <div className="mt-4 flex gap-2">
          {!failed ? (
            <button type="button" className={`${btn.primary} flex-1`} disabled={!stream || busy} onClick={snap}>
              Take photo
            </button>
          ) : (
            <button type="button" className={`${btn.primary} flex-1`} disabled={busy} onClick={() => picker.current?.click()}>
              Open camera
            </button>
          )}
          <button type="button" className={btn.ghost} onClick={onCancel}>
            Cancel
          </button>
        </div>
        <input ref={picker} type="file" accept="image/*" capture="user" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
      </div>
    </div>
  );
}
