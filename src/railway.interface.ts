export interface GraphQLEdges<T> {
	edges: {
		node: T
	}[]
}

export interface ServiceInstance {
	id: string
	domains: {
		serviceDomains: {
			domain: string
			id: string
		}[]
	}
	serviceId: string
	startCommand: string
}

export interface Deployment {
	id: string
	status: string
}

export interface Environment {
	id: string
	name: string
	createdAt: string
	deployments: GraphQLEdges<Deployment>
	deploymentTriggers: GraphQLEdges<DeploymentTrigger>
	serviceInstances: GraphQLEdges<ServiceInstance>
}

export interface Service {
	name: string
}

export interface DeploymentTrigger {
	id: string
	environmentId: string
	branch: string
	projectId: string
}
