import './model'

declare module './model' {
  interface SourceMetadata {
    /** AARC source point that supplied this station's display name via cluster/link lookup. */
    resolvedNameSourcePointId?: number
  }
}
