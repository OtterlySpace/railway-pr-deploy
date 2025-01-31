import core from "@actions/core"
import { context } from "@actions/github"
import { GraphQLClient, gql } from "graphql-request"
import { z } from "zod"

import { type Environment, type GraphQLEdges, type Service, type ServiceInstance } from "~/railway.interface"

// Railway Required Inputs
const RAILWAY_API_TOKEN = core.getInput("RAILWAY_API_TOKEN")
const PROJECT_ID = core.getInput("PROJECT_ID")
const SRC_ENVIRONMENT_NAME = core.getInput("SRC_ENVIRONMENT_NAME")
const SRC_ENVIRONMENT_ID = core.getInput("SRC_ENVIRONMENT_ID")
const DEST_ENV_NAME = core.getInput("DEST_ENV_NAME")
const ENV_VARS = core.getInput("ENV_VARS")
const FAIL_IF_EXISTS = core.getInput("FAIL_IF_EXISTS")
const API_SERVICE_NAME = core.getInput("API_SERVICE_NAME")
const IGNORE_SERVICE_REDEPLOY = core.getInput("IGNORE_SERVICE_REDEPLOY")
const ENDPOINT = "https://backboard.railway.app/graphql/v2"

// Github Required Inputs
const BRANCH_NAME = context.ref.replace("refs/heads/", "")

// #region Railway GraphQL Client

async function railwayGraphQLRequest<T>(query: string, variables: Record<string, unknown>) {
	const client = new GraphQLClient(ENDPOINT, {
		headers: {
			Authorization: `Bearer ${RAILWAY_API_TOKEN}`
		}
	})
	try {
		return await client.request<T>({ document: query, variables })
	} catch (error) {
		core.setFailed(`Action failed with error: ${error}`)
		throw error
	}
}

async function getEnvironments() {
	const query = gql`
		query environments($projectId: String!) {
			environments(projectId: $projectId) {
				edges {
					node {
						id
						name
						createdAt
						deployments {
							edges {
								node {
									id
									status
								}
							}
						}
						deploymentTriggers {
							edges {
								node {
									id
									environmentId
									branch
									projectId
								}
							}
						}
						serviceInstances {
							edges {
								node {
									id
									domains {
										serviceDomains {
											domain
											id
										}
									}
									serviceId
									startCommand
								}
							}
						}
					}
				}
			}
		}
	`

	const variables = {
		projectId: PROJECT_ID
	}

	return await railwayGraphQLRequest<{
		environments: GraphQLEdges<Environment>
	}>(query, variables)
}

async function createEnvironment(sourceEnvironmentId: string) {
	console.log("Creating Environment... based on source environment ID:", sourceEnvironmentId)
	try {
		const query = gql`
			mutation environmentCreate($input: EnvironmentCreateInput!) {
				environmentCreate(input: $input) {
					id
					name
					createdAt
					deployments {
						edges {
							node {
								id
								status
							}
						}
					}
					deploymentTriggers {
						edges {
							node {
								id
								environmentId
								branch
								projectId
							}
						}
					}
					serviceInstances {
						edges {
							node {
								id
								domains {
									serviceDomains {
										domain
										id
									}
								}
								serviceId
								startCommand
							}
						}
					}
				}
			}
		`
		const variables = {
			input: {
				name: DEST_ENV_NAME,
				projectId: PROJECT_ID,
				sourceEnvironmentId: sourceEnvironmentId
			}
		}
		return await railwayGraphQLRequest<{
			environmentCreate: Environment
		}>(query, variables)
	} catch (error) {
		core.setFailed(`Action failed with error: ${error}`)
		throw error
	}
}

async function updateEnvironment(environmentId: string, serviceId: string, variables: string) {
	const variablesSchema = z.record(z.string(), z.string())

	try {
		const parsedVariables = JSON.parse(variables) as unknown
		const parsedVariablesSchema = variablesSchema.parse(parsedVariables)

		const query = gql`
			mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
				variableCollectionUpsert(input: $input)
			}
		`

		const queryVariables = {
			input: {
				environmentId: environmentId,
				projectId: PROJECT_ID,
				serviceId: serviceId,
				variables: parsedVariablesSchema
			}
		}

		return await railwayGraphQLRequest(query, queryVariables)
	} catch (error) {
		core.setFailed(`Action failed with error: ${error}`)
		throw error
	}
}

async function deploymentTriggerUpdate(deploymentTriggerId: string) {
	console.log("Updating Deploying Trigger to new Branch Name")
	try {
		const query = gql`
			mutation deploymentTriggerUpdate($id: String!, $input: DeploymentTriggerUpdateInput!) {
				deploymentTriggerUpdate(id: $id, input: $input) {
					id
				}
			}
		`

		const variables = {
			id: deploymentTriggerId,
			input: {
				branch: BRANCH_NAME
			}
		}

		return await railwayGraphQLRequest<{
			deploymentTriggerUpdate: {
				id: string
			}
		}>(query, variables)
	} catch (error) {
		core.setFailed(`Action failed with error: ${error}`)
		throw error
	}
}

async function serviceInstanceRedeploy(environmentId: string, serviceId: string) {
	console.log("Redeploying Service...")
	console.log("Environment ID:", environmentId)
	console.log("Service ID:", serviceId)
	try {
		const query = gql`
			mutation serviceInstanceRedeploy($environmentId: String!, $serviceId: String!) {
				serviceInstanceRedeploy(environmentId: $environmentId, serviceId: $serviceId)
			}
		`

		const variables = {
			environmentId: environmentId,
			serviceId: serviceId
		}

		return await railwayGraphQLRequest(query, variables)
	} catch (error) {
		core.setFailed(`Action failed with error: ${error}`)
		throw error
	}
}

async function getService(serviceId: string) {
	const query = gql`
		query environments($id: String!) {
			service(id: $id) {
				name
			}
		}
	`

	const variables = {
		id: serviceId
	}

	return await railwayGraphQLRequest<{
		service: Service
	}>(query, variables)
}

// #endregion

async function updateAllDeploymentTriggers(deploymentTriggerIds: string[]) {
	try {
		// Create an array of promises
		const updatePromises = deploymentTriggerIds.map((deploymentTriggerId) =>
			deploymentTriggerUpdate(deploymentTriggerId)
		)

		// Await all promises
		await Promise.all(updatePromises)
		console.log("All deployment triggers updated successfully.")
	} catch (error) {
		console.error("An error occurred during the update:", error)
		throw error
	}
}

async function updateEnvironmentVariablesForServices(
	environmentId: string,
	serviceInstances: GraphQLEdges<ServiceInstance>,
	ENV_VARS: string
) {
	const serviceIds = []

	// Extract service IDs
	for (const serviceInstance of serviceInstances.edges) {
		const { serviceId } = serviceInstance.node
		serviceIds.push(serviceId)
	}

	try {
		// Create an array of promises for updating environment variables
		const updatePromises = serviceIds.map((serviceId) => updateEnvironment(environmentId, serviceId, ENV_VARS))

		// Await all promises to complete
		await Promise.all(updatePromises)
		console.log("Environment variables updated for all services.")
	} catch (error) {
		console.error("An error occurred during the update:", error)
		throw error
	}
}

async function redeployAllServices(environmentId: string, servicesToRedeploy: string[]) {
	try {
		// Create an array of promises for redeployments
		const redeployPromises = servicesToRedeploy.map((serviceId) =>
			serviceInstanceRedeploy(environmentId, serviceId)
		)

		// Await all promises to complete
		await Promise.all(redeployPromises)
		console.log("All services redeployed successfully.")
	} catch (error) {
		console.error("An error occurred during redeployment:", error)
	}
}

async function run() {
	try {
		// Get Environments to check if the environment already exists
		const response = await getEnvironments()

		let environment: Environment

		// Filter the response to only include the environment name we are looking to create
		const filteredEdges = response.environments.edges.find((edge) => edge.node.name === DEST_ENV_NAME)

		// If there is a match this means the environment already exists
		if (filteredEdges) {
			if (FAIL_IF_EXISTS === "true") {
				throw new Error(
					"Environment already exists. Please delete the environment via API or Railway Dashboard and try again."
				)
			}
			environment = filteredEdges.node
			console.log("Re-using Environment:")
			console.dir(environment, { depth: null })
		} else {
			let srcEnvironmentId = SRC_ENVIRONMENT_ID

			// If no source ENV_ID provided get Source Environment ID to base new PR environment from (aka use the same environment variables)
			if (!SRC_ENVIRONMENT_ID) {
				const srcEnvironment = response.environments.edges.find(
					(edge) => edge.node.name === SRC_ENVIRONMENT_NAME
				)
				if (!srcEnvironment) {
					throw new Error(`Source Environment ${SRC_ENVIRONMENT_NAME} not found`)
				}
				srcEnvironmentId = srcEnvironment.node.id
			}

			// Create the new Environment based on the Source Environment
			const createdEnvironment = await createEnvironment(srcEnvironmentId)
			environment = createdEnvironment.environmentCreate
			console.log("Created Environment:")
			console.dir(environment, { depth: null })
		}

		const { id: environmentId } = environment

		// Get all the Deployment Triggers
		const deploymentTriggerIds = []
		for (const deploymentTrigger of environment.deploymentTriggers.edges) {
			const { id: deploymentTriggerId } = deploymentTrigger.node
			deploymentTriggerIds.push(deploymentTriggerId)
		}

		// Get all the Service Instances
		const { serviceInstances } = environment

		// Update the Environment Variables on each Service Instance
		await updateEnvironmentVariablesForServices(environmentId, serviceInstances, ENV_VARS)

		// Wait for the created environment to finish initializing
		console.log("Waiting 15 seconds for deployment to initialize and become available")
		await new Promise((resolve) => setTimeout(resolve, 15000)) // Wait for 15 seconds

		// Set the Deployment Trigger Branch for Each Service
		await updateAllDeploymentTriggers(deploymentTriggerIds)

		const servicesToIgnoreJson = JSON.parse(IGNORE_SERVICE_REDEPLOY) as unknown
		const servicesToIgnore = z.array(z.string()).parse(servicesToIgnoreJson)
		const servicesToRedeploy: string[] = []

		// Get the names for each deployed service
		for (const serviceInstance of environment.serviceInstances.edges) {
			const { domains } = serviceInstance.node
			const { service } = await getService(serviceInstance.node.serviceId)
			const { name } = service

			if (!servicesToIgnore.includes(name)) {
				servicesToRedeploy.push(serviceInstance.node.serviceId)
			}

			if (
				(API_SERVICE_NAME && name === API_SERVICE_NAME) ||
				name === "app" ||
				name === "backend" ||
				name === "web"
			) {
				const domain = domains.serviceDomains?.[0]?.domain
				console.log("Domain:", domain)
				core.setOutput("service_domain", domain)
			}
		}

		// Redeploy the Services
		await redeployAllServices(environmentId, servicesToRedeploy)
	} catch (error) {
		console.error("Error in API calls:", error)
		// Handle the error, e.g., fail the action
		core.setFailed("API calls failed")
	}
}

void run()
