import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Modal, Button } from '@/components/ui'
import { copyText } from '@/lib/utils'
import { useToast } from '@/components/Toast'

export function QRCodeModal({ open, onClose, url, title }: { open: boolean; onClose: () => void; url: string; title?: string }) {
  const [dataUrl, setDataUrl] = useState('')
  const { show } = useToast()

  useEffect(() => {
    if (!open || !url) return
    QRCode.toDataURL(url, { width: 320, margin: 2, errorCorrectionLevel: 'M' })
      .then(setDataUrl)
      .catch(() => setDataUrl(''))
  }, [open, url])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || '短链二维码'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button
            onClick={async () => {
              const ok = await copyText(url)
              show(ok ? '链接已复制' : '复制失败', ok ? 'success' : 'error')
            }}
          >
            复制链接
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        {dataUrl ? (
          <img src={dataUrl} alt="二维码" className="h-64 w-64 rounded-lg bg-white p-2" />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center rounded-lg bg-gray-100 text-sm text-gray-400 dark:bg-gray-800">
            生成中...
          </div>
        )}
        <p className="break-all text-center text-sm text-gray-600 dark:text-gray-400">{url}</p>
      </div>
    </Modal>
  )
}
