import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getLogger } from './logger.service'

const MAX_RULE_FILE_SIZE = 1_048_576 // 1 MB
const MAX_RULE_COUNT = 100

export class CustomYaraService {
  private customRulesDir: string

  constructor() {
    this.customRulesDir = join(app.getPath('userData'), 'custom-yara-rules')
    this.ensureDir()
  }

  private ensureDir(): void {
    if (!existsSync(this.customRulesDir)) {
      mkdirSync(this.customRulesDir, { recursive: true })
    }
  }

  getRulesDir(): string {
    return this.customRulesDir
  }

  getCustomRules(): { name: string; content: string; size: number; addedAt: Date }[] {
    this.ensureDir()
    const files = readdirSync(this.customRulesDir).filter((f) => f.endsWith('.yar') || f.endsWith('.yara'))
    return files.map((name) => {
      const fullPath = join(this.customRulesDir, name)
      const content = readFileSync(fullPath, 'utf-8')
      return { name, content, size: Buffer.byteLength(content, 'utf-8'), addedAt: new Date() }
    })
  }

  addRule(name: string, content: string): boolean {
    let ruleName = name
    if (!ruleName.endsWith('.yar') && !ruleName.endsWith('.yara')) {
      ruleName += '.yar'
    }
    if (!content.toLowerCase().includes('rule ')) return false

    // Enforce max file size (1 MB)
    if (Buffer.byteLength(content, 'utf-8') > MAX_RULE_FILE_SIZE) {
      getLogger().warning('custom-yara', `Rule "${ruleName}" rejected: file size exceeds 1 MB limit`)
      return false
    }

    // Enforce max rule count (100 rules per custom set)
    const currentCount = this.getRuleCount()
    if (currentCount >= MAX_RULE_COUNT) {
      getLogger().warning('custom-yara', `Rule "${ruleName}" rejected: max ${MAX_RULE_COUNT} rules per custom set`)
      return false
    }

    this.ensureDir()
    const filePath = join(this.customRulesDir, ruleName)
    writeFileSync(filePath, content, 'utf-8')
    return true
  }

  removeRule(name: string): boolean {
    const filePath = join(this.customRulesDir, name)
    if (!existsSync(filePath)) return false
    unlinkSync(filePath)
    return true
  }

  getRuleCount(): number {
    this.ensureDir()
    return readdirSync(this.customRulesDir).filter((f) => f.endsWith('.yar') || f.endsWith('.yara')).length
  }
}

export const customYaraService = new CustomYaraService()
