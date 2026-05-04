import { useQuery } from '@tanstack/react-query'
import { fetchPickingData } from '../services/api'

export function usePickingData(pickingCode) {
  return useQuery({
    queryKey: ['picking', pickingCode],
    queryFn: () => fetchPickingData(pickingCode),
    enabled: !!pickingCode,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}
