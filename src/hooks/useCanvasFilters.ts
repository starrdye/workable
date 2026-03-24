// src/hooks/useCanvasFilters.ts
// Manages search query, role filters, group filters, and sidebar panel visibility.
// Track 8b

import { useState } from 'react';

export function useCanvasFilters() {
  const [searchQuery,  setSearchQuery]  = useState('');
  const [roleFilters,  setRoleFilters]  = useState<string[]>([]);
  const [groupFilters, setGroupFilters] = useState<string[]>([]);
  const [showFilters,  setShowFilters]  = useState(false);
  const [showGroups,   setShowGroups]   = useState(true);

  const hasActiveFilters =
    roleFilters.length > 0 ||
    groupFilters.length > 0 ||
    searchQuery.trim().length > 0;

  const clearAllFilters = () => {
    setSearchQuery('');
    setRoleFilters([]);
    setGroupFilters([]);
  };

  return {
    searchQuery, setSearchQuery,
    roleFilters, setRoleFilters,
    groupFilters, setGroupFilters,
    showFilters, setShowFilters,
    showGroups, setShowGroups,
    hasActiveFilters,
    clearAllFilters,
  };
}
