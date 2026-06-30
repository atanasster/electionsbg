// Shared bilingual labels for the road work-group + component taxonomies.
// The canonical maps live in the dependency-free engine (@/lib/roadAttributes)
// so the AI narration layer can share them without importing src/screens; this
// module just re-exports them under the local path the tiles already use.

export { GROUP_META, COMPONENT_LABEL } from "@/lib/roadAttributes";
