'use client'
// Tiptap-based rich-text editor for resolution bodies. Emits sanitized
// HTML on every change — the backend STILL sanitizes on save; this is
// not security, it's just a sensible authoring surface.

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'

export function RichTextEditor({
  value, onChange, disabled, placeholder, minHeight = 160,
}: {
  value: string
  onChange: (html: string) => void
  disabled?: boolean
  placeholder?: string
  minHeight?: number
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] } }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
    ],
    content: value,
    editable: !disabled,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    immediatelyRender: false,
  })

  if (!editor) {
    return (
      <div className="w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-400"
           style={{ minHeight }}>
        {placeholder || 'Loading editor…'}
      </div>
    )
  }

  return (
    <div className="rounded border border-gray-200 bg-white">
      <Toolbar editor={editor} disabled={disabled} />
      <EditorContent
        editor={editor}
        className="prose prose-sm max-w-none px-3 py-2"
        style={{ minHeight }}
      />
    </div>
  )
}

function Toolbar({ editor, disabled }: { editor: Editor; disabled?: boolean }) {
  if (disabled) return <div className="h-0" />
  const btn = (active: boolean) =>
    `px-2 py-1 text-xs rounded ${active ? 'bg-gray-200' : 'hover:bg-gray-100'}`
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-2 py-1">
      <button type="button" className={btn(editor.isActive('bold'))}
        onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
      <button type="button" className={btn(editor.isActive('italic'))}
        onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
      <button type="button" className={btn(editor.isActive('strike'))}
        onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></button>
      <span className="mx-1 h-4 w-px bg-gray-300" />
      <button type="button" className={btn(editor.isActive('heading', { level: 2 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
      <button type="button" className={btn(editor.isActive('heading', { level: 3 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</button>
      <span className="mx-1 h-4 w-px bg-gray-300" />
      <button type="button" className={btn(editor.isActive('bulletList'))}
        onClick={() => editor.chain().focus().toggleBulletList().run()}>•</button>
      <button type="button" className={btn(editor.isActive('orderedList'))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</button>
      <button type="button" className={btn(editor.isActive('blockquote'))}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}>“ ”</button>
      <span className="mx-1 h-4 w-px bg-gray-300" />
      <button type="button" className={btn(editor.isActive('link'))}
        onClick={() => {
          const prev = editor.getAttributes('link').href as string | undefined
          const url = window.prompt('URL', prev || 'https://')
          if (url === null) return
          if (url === '') editor.chain().focus().unsetLink().run()
          else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
        }}>🔗</button>
    </div>
  )
}
