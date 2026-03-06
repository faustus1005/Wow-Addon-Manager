import React from 'react'

interface Props {
  size?: 'sm' | 'md' | 'lg'
  message?: string
}

const sizes = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12' }

export default function LoadingSpinner({ size = 'md', message }: Props) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`${sizes[size]} border-2 border-gray-700 border-t-wow-gold rounded-full animate-spin`}
      />
      {message && <p className="text-gray-500 text-sm">{message}</p>}
    </div>
  )
}
