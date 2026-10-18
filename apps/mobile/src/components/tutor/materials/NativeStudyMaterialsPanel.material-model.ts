import type { StudyMaterial } from "@recall/application";

export function toggleNativeStudyMaterialSectionSelection(
  material: StudyMaterial,
  sectionId: string,
): StudyMaterial {
  const sections = material.sections.map((section) => {
    if (section.id !== sectionId) return section;
    return { ...section, selected: !section.selected };
  });
  return { ...material, sections };
}
