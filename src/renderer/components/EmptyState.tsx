import React from 'react'

interface Props {
  icon?: string
  title: string
  description?: string
  action?: React.ReactNode
}

export default function EmptyState({ icon = '📭', title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <span className="text-6xl opacity-40">{icon}</span>
      <div>
        <h3 className="text-gray-300 font-semibold">{title}</h3>
        {description && <p className="text-gray-600 text-sm mt-1 max-w-xs">{description}</p>}
      </div>
      {action}
    </div>
  )
}
