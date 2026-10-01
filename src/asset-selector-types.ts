export interface AssetSelectorItem {
  id: string;
  name: string;
  avatar: string;
  subtitle?: string;
  disabled?: boolean;
}

export interface AssetSelectorFilter { name: string; label: string }
