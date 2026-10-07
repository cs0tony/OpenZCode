import { OPEN_ZCODE_SCRATCH_WORKSPACE_DIR_NAME } from "@zcode/shared";

export function getScratchWorkspaceLocationHint(name: string) {
  return `~/${OPEN_ZCODE_SCRATCH_WORKSPACE_DIR_NAME}/${name.trim()}`;
}

export function getScratchWorkspaceNameErrorKind(name: string) {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return "required";
  }

  if (/[\\/]/.test(trimmedName)) {
    return "separator";
  }

  return null;
}
