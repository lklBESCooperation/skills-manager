import type { AgentId, EffectiveAgentSkillState } from '../contracts/skill-enablement'
import type {
  ManagedSkillViewItem,
  SkillAgentMatrixInput,
  SkillAgentMatrixOutput
} from '../contracts/skill-ui-bridge-contract'

export type ResolvedAgentMatrix = {
  agents: Partial<Record<AgentId, boolean>>
  agentDetails: Partial<Record<AgentId, EffectiveAgentSkillState>>
}

/**
 * Frontend cache and async loader for on-demand 45-agent skill matrices.
 * Tracks per-row and global invalidation generations so stale responses after
 * refresh/mutation/`skills.changed` never overwrite fresh state.
 */
export class AgentMatrixCache {
  private readonly entries = new Map<string, SkillAgentMatrixOutput>()
  private readonly loadingKeys = new Set<string>()
  private readonly errors = new Map<string, string>()
  private readonly rowGenerations = new Map<string, number>()
  private globalGeneration = 0

  resolve(
    item: Pick<ManagedSkillViewItem, 'rowKey' | 'agents' | 'agentDetails'>
  ): ResolvedAgentMatrix | null {
    if (item.agents !== undefined && item.agentDetails !== undefined) {
      return {
        agents: item.agents,
        agentDetails: item.agentDetails
      }
    }
    const cached = this.entries.get(item.rowKey)
    if (!cached) {
      return null
    }
    return {
      agents: item.agents ?? cached.agents,
      agentDetails: item.agentDetails ?? cached.agentDetails
    }
  }

  has(rowKey: string): boolean {
    return this.entries.has(rowKey)
  }

  isLoading(rowKey: string): boolean {
    return this.loadingKeys.has(rowKey)
  }

  getError(rowKey: string): string | undefined {
    return this.errors.get(rowKey)
  }

  invalidateAll(): void {
    this.entries.clear()
    this.loadingKeys.clear()
    this.errors.clear()
    this.rowGenerations.clear()
    this.globalGeneration += 1
  }

  invalidateRow(rowKey: string): void {
    this.entries.delete(rowKey)
    this.loadingKeys.delete(rowKey)
    this.errors.delete(rowKey)
    this.rowGenerations.set(rowKey, (this.rowGenerations.get(rowKey) ?? 0) + 1)
  }

  async load(
    item: Pick<ManagedSkillViewItem, 'rowKey' | 'id' | 'scope' | 'agents' | 'agentDetails'>,
    fetcher: (input: SkillAgentMatrixInput) => Promise<SkillAgentMatrixOutput>,
    onUpdate: () => void,
    formatError: (error: unknown) => string = (err) => String(err || 'Unknown error')
  ): Promise<void> {
    if (this.resolve(item) || this.loadingKeys.has(item.rowKey)) {
      return
    }

    const expectedGlobalGen = this.globalGeneration
    const expectedRowGen = this.rowGenerations.get(item.rowKey) ?? 0
    const isCurrent = (): boolean =>
      this.globalGeneration === expectedGlobalGen &&
      (this.rowGenerations.get(item.rowKey) ?? 0) === expectedRowGen

    this.loadingKeys.add(item.rowKey)
    this.errors.delete(item.rowKey)
    onUpdate()

    try {
      const matrix = await fetcher({ skillId: item.id, scope: item.scope })
      if (!isCurrent()) {
        return
      }
      this.entries.set(matrix.rowKey || item.rowKey, matrix)
    } catch (error) {
      if (!isCurrent()) {
        return
      }
      this.errors.set(item.rowKey, formatError(error))
    } finally {
      if (isCurrent()) {
        this.loadingKeys.delete(item.rowKey)
        onUpdate()
      }
    }
  }
}
