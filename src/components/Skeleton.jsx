import React from 'react'

export function Skeleton({ w='100%', h=16, radius=8, style={} }) {
  return <div className="sk" style={{ width:w, height:h, borderRadius:radius, ...style }} />
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="panel">
      <Skeleton w="40%" h={22} style={{ marginBottom: 14 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} h={14} style={{ marginBottom: 10 }} w={`${90 - i * 10}%`} />
      ))}
    </div>
  )
}

export function SkeletonKpis({ n = 4 }) {
  return (
    <div className="kpis">
      {Array.from({ length: n }).map((_, i) => (
        <div className="kpi" key={i}>
          <Skeleton h={28} w="60%" style={{ margin: '0 auto 8px' }} />
          <Skeleton h={12} w="80%" style={{ margin: '0 auto' }} />
        </div>
      ))}
    </div>
  )
}

export function SkeletonTiles({ n = 8 }) {
  return (
    <div className="units-grid">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="unit-tile" style={{ opacity: .55 }}>
          <Skeleton h={20} w="30%" style={{ marginBottom: 12 }} />
          <Skeleton h={38} w="50%" style={{ marginBottom: 10 }} />
          <Skeleton h={12} w="70%" />
        </div>
      ))}
    </div>
  )
}

export function FullPageLoading({ label = 'المازن — جارٍ التحميل…' }) {
  return (
    <div className="full-loading">
      <div className="loading-brand">
        <div className="loading-mark">م</div>
        <div className="loading-ring" />
      </div>
      <div className="loading-label">{label}</div>
    </div>
  )
}
