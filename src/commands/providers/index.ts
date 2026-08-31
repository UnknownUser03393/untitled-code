import type { Command } from '../../commands.js'

const providers = {
  type: 'local-jsx',
  name: 'providers',
  description: 'Manage AI providers and discover models for routing',
  argumentHint: '[list|scan|doctor|route <organization/modelId>|help]',
  load: () => import('./providers.js'),
} satisfies Command

export default providers
