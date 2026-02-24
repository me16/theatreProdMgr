import { state } from './state.js';

export const isOwner = () => state.activeRole === 'owner' || state.isSuperAdmin;
export const isMember = () => !!state.activeRole;
export const canEditZones = () => isOwner();
export const canEditProps = () => isOwner();
export const canUploadScript = () => isOwner();
