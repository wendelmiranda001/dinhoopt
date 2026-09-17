export interface GamingTimerStatus {
  hpetOff: boolean
  tscSyncPolicy: 'legacy' | 'enhanced' | 'default'
  dynamicTickDisabled: boolean
  autoTuningDisabled: boolean
}
