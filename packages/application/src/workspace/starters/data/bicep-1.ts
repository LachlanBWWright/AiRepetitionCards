// CC BY 4.0; source, attribution and conversion details in ../README.md.
export default [
  [
    "anki:Hs*{FH,qsA:0",
    "What is Bicep?",
    "What is Bicep?\n\nA domain-specific language for deploying Azure resources declaratively. You describe the desired end state and Azure makes it so. (It is Microsoft's native infrastructure-as-code for Azure, the cleaner successor to writing raw ARM JSON.)",
  ],
  [
    "anki:FS4bYqPpE[:0",
    "What is the relationship between Bicep and ARM?",
    "What is the relationship between Bicep and ARM?\n\nBicep is a friendlier language that transpiles down to ARM JSON. ARM is the underlying deployment engine that actually processes the template. (You write Bicep, it compiles to ARM, Azure runs the ARM. Every Bicep deployment is really an ARM deployment underneath.)",
  ],
  [
    "anki:oqi|^bMcY^:0",
    "What does it mean that Bicep is declarative?",
    "What does it mean that Bicep is declarative?\n\nYou declare the end state you want, not the step-by-step commands to get there. Azure figures out what to create, update, or leave alone. (Same declarative model as Terraform; you describe the destination, not the route.)",
  ],
  [
    "anki:moTX/Rxg1-:0",
    "Is Bicep stateful or stateless, and what does that mean?",
    "Is Bicep stateful or stateless, and what does that mean?\n\nStateless. There is no separate state file to store or maintain. At deploy time Bicep compares your file to the live state of Azure and reconciles the difference. (This is the big contrast with Terraform, which keeps a state file. Your Bicep file still declares desired state; there is just no persisted state file.)",
  ],
  [
    "anki:Ag+!IJJ)gz:0",
    "What is idempotency in Bicep, and why does it matter?",
    "What is idempotency in Bicep, and why does it matter?\n\nRunning the same Bicep file repeatedly produces the same result; it only changes what differs from the current state. (You can re-run a deployment safely without creating duplicates. Same guarantee Terraform gives.)",
  ],
  [
    "anki:x:h?OSIJD{:0",
    "How does Bicep differ from Terraform on state?",
    "How does Bicep differ from Terraform on state?\n\nBicep is stateless and reads live Azure at deploy time. Terraform keeps a state file that must be stored remotely and locked. (Terraform has a whole class of state-related failures, like drift and lock conflicts, that Bicep simply cannot have.)",
  ],
  [
    "anki:iDK(tc!]1F:0",
    "What is Bicep's preview command versus Terraform's?",
    "What is Bicep's preview command versus Terraform's?\n\nBicep uses what-if to preview changes; Terraform uses plan. (Both show you what will change before you apply, but what-if computes against live Azure while plan computes against the state file.)",
  ],
  [
    "anki:wZbZ#o22sp:0",
    "When would you choose Bicep over Terraform?",
    "When would you choose Bicep over Terraform?\n\nWhen you are all-in on Azure: Bicep is native, always day-one current with new Azure features, stateless, and simpler for a compliance boundary. (Terraform wins when you need multi-cloud; Bicep wins for pure-Azure simplicity.)",
  ],
  [
    "anki:uFne`XbN7g:0",
    "What are the main building blocks of a Bicep file?",
    "What are the main building blocks of a Bicep file?\n\nParameters, variables, resources, modules, and outputs. (Parameters are inputs, variables are computed values, resources are what you deploy, modules are reusable sub-templates, outputs return values.)",
  ],
  [
    "anki:h!77B{1Cu9:0",
    "What is a parameter in Bicep?",
    "What is a parameter in Bicep?\n\nAn input value you pass in at deploy time, declared with the param keyword: param location string. (Lets one template serve many environments; like a Terraform variable.)",
  ],
  [
    "anki:xTLXSmk~B*:0",
    "What is a variable in Bicep?",
    "What is a variable in Bicep?\n\nA named value computed inside the template with the var keyword, not passed in: var name = '${prefix}-app'. (For values you build from parameters or reuse; Terraform's locals are the equivalent.)",
  ],
  [
    "anki:r(IeKnZYnM:0",
    "What is a resource declaration in Bicep?",
    "What is a resource declaration in Bicep?\n\nThe resource keyword defines something to deploy: resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = { ... }. (The type string includes the API version after the @.)",
  ],
  [
    "anki:A7!0UtJSJ]:0",
    "What is an output in Bicep?",
    "What is an output in Bicep?\n\nA value the template returns after deployment with the output keyword: output endpoint string = sa.properties.primaryEndpoints.blob. (Used to pass values back to a pipeline or a calling module; like a Terraform output.)",
  ],
  [
    "anki:A4chmw,SqQ:0",
    "What is the API version in a resource type, and why does it matter?",
    "What is the API version in a resource type, and why does it matter?\n\nThe date after the @ in the type string (for example @2023-01-01) pins which version of the resource provider schema you deploy against. (Newer API versions expose newer properties; choosing it deliberately affects what features are available.)",
  ],
  [
    "anki:ir=&.(SBm(:0",
    "How do you reference one resource's property from another resource?",
    "How do you reference one resource's property from another resource?\n\nUse symbolic name dot property: sa.id or sa.properties.primaryEndpoints.blob. (Bicep automatically infers a dependency from the reference, so you rarely need dependsOn.)",
  ],
  [
    "anki:P:4k[(,Hp:0",
    "What is dependsOn, and why do you usually not need it in Bicep?",
    "What is dependsOn, and why do you usually not need it in Bicep?\n\nIt forces a deployment order between resources. Bicep infers dependencies automatically when one resource references another, so you only add dependsOn for hidden dependencies it cannot see. (Cleaner than ARM, where you often wrote dependsOn by hand.)",
  ],
  [
    "anki:FKx4%i{ygv:0",
    "What are decorators in Bicep?",
    "What are decorators in Bicep?\n\nAnnotations on parameters that add constraints or metadata, like @minLength(3), @allowed(['dev','prod']), @description('...'), @secure(). (They validate inputs before deployment; @secure hides a value from logs.)",
  ],
  [
    "anki:v1sUH*p(Zc:0",
    "What does the @secure() decorator do?",
    "What does the @secure() decorator do?\n\nMarks a parameter (like a password or key) as sensitive so its value is not logged or shown in deployment history. (Essential for secrets passed into a template.)",
  ],
  [
    "anki:IzT/PG^mZH:0",
    "How do loops work in Bicep?",
    "How do loops work in Bicep?\n\nThe for expression creates multiple resources or values: [for item in items: { ... }]. (Deploy N similar resources from an array; like Terraform's count or for_each.)",
  ],
  [
    "anki:s}+d__M{30:0",
    "How do conditions work in Bicep?",
    "How do conditions work in Bicep?\n\nAppend if(condition) to a resource to deploy it only when true: resource x '...' = if(deployStorage) { ... }. (Conditional deployment of a resource based on a parameter.)",
  ],
  [
    "anki:P!gHvA<8d|:0",
    "What is string interpolation in Bicep?",
    "What is string interpolation in Bicep?\n\nEmbedding expressions in a string with ${}: '${prefix}-storage'. (Builds names dynamically; like the same syntax in many languages.)",
  ],
  [
    "anki:Q9bc-_GuQU:0",
    "What is the difference between existing resources and deployed resources in Bicep?",
    "What is the difference between existing resources and deployed resources in Bicep?\n\nAdding the 'existing' keyword references a resource already in Azure without deploying or managing it: resource kv '...' existing = { name: 'myVault' }. (Use it to read properties of something you did not create, like an existing key vault.)",
  ],
  [
    "anki:p]p~Z1Hc*i:0",
    "What is a module in Bicep?",
    "What is a module in Bicep?\n\nA separate Bicep file you call from another to reuse infrastructure, invoked with the module keyword. (The reuse mechanism; roughly a Terraform module. It keeps templates composable instead of one giant file.)",
  ],
  [
    "anki:qhG(_wj1=?:0",
    "How do you consume a module in Bicep?",
    "How do you consume a module in Bicep?\n\nmodule stg './storage.bicep' = { name: 'deployStorage', params: { ... } }. (You point at the file path and pass parameters, just like calling a function.)",
  ],
  [
    "anki:Ak)eQYrm@-:0",
    "What is a Bicep registry?",
    "What is a Bicep registry?\n\nA place to publish and share modules, backed by an Azure Container Registry, referenced with br: (for example br/public: for the public registry). (Lets teams share versioned modules instead of copying files around.)",
  ],
  [
    "anki:Jx.;W$E/oR:0",
    "What are Azure Verified Modules (AVM)?",
    "What are Azure Verified Modules (AVM)?\n\nMicrosoft-maintained, versioned, best-practice modules you consume from the public registry: br/public:avm/res/storage/storage-account:0.9.0. Three types: res (single resource), ptn (pattern), and utl (utility). (You customize via their exposed parameters rather than forking.)",
  ],
  [
    "anki:tDqaL^#/y2:0",
    "What is a .bicepparam file?",
    "What is a .bicepparam file?\n\nA dedicated parameter file written in Bicep syntax that supplies values to a Bicep template, keeping parameters separate from the template itself. (Cleaner than the old JSON parameter files; one template, many .bicepparam files for different environments.)",
  ],
  [
    "anki:niZ{7<R9hp:0",
    "What is the 'using' statement in a .bicepparam file?",
    "What is the 'using' statement in a .bicepparam file?\n\nThe line at the top that ties the parameter file to its Bicep template: using './main.bicep'. It tells the param file which template's parameters it is filling in. (Required in every .bicepparam file; the pipeline tasks check for it.)",
  ],
  [
    "anki:byK}7(U1PR:0",
    "Why use a separate .bicepparam file instead of inline parameters?",
    "Why use a separate .bicepparam file instead of inline parameters?\n\nIt separates configuration from code, so the same template deploys to dev, test, and prod by swapping parameter files. (Standard practice for environment-specific values.)",
  ],
  [
    "anki:Q`%xP[aJ@7:0",
    "What deployment scopes does Bicep support?",
    "What deployment scopes does Bicep support?\n\nResource group, subscription, management group, and tenant. (You pick the scope based on what you are deploying: a storage account at resource group scope, a policy at management group scope, and so on.)",
  ],
  [
    "anki:fEm;f6rZ0V:0",
    "What is the targetScope keyword?",
    "What is the targetScope keyword?\n\nIt sets the scope a Bicep file deploys at: targetScope = 'subscription'. Default is resourceGroup if omitted. (Tells Azure whether you are deploying into a resource group, subscription, management group, or tenant.)",
  ],
  [
    "anki:G?ZYri9k6h:0",
    "What CLI command deploys a Bicep file at resource group scope?",
    "What CLI command deploys a Bicep file at resource group scope?\n\naz deployment group create --resource-group RG --template-file main.bicep --parameters main.bicepparam. (The group in the command name is the scope. Subscription scope uses az deployment sub create.)",
  ],
  [
    "anki:LG<SqFjl|~:0",
    "What is a .bicepparam gotcha with az deployment group create?",
    "What is a .bicepparam gotcha with az deployment group create?\n\nWhen you pass a .bicepparam file, you cannot also override individual parameters on the command line. (You either use the param file as-is or switch to inline parameters.)",
  ],
  [
    "anki:wFEFa^VK&V:0",
    "Does the Bicep deployment create the resource group for you?",
    "Does the Bicep deployment create the resource group for you?\n\nNo. At resourceGroup scope the target resource group must already exist; the deployment puts resources into it. (Create the resource group first, or deploy at subscription scope to create it as part of the deployment.)",
  ],
  [
    "anki:q*xdkO,$$w:0",
    "What is the what-if operation?",
    "What is the what-if operation?\n\nA preview that shows what a deployment would create, modify, or delete before you actually run it: az deployment group what-if. (The safety check before applying; Terraform's plan is the equivalent.)",
  ],
  [
    "anki:cQn-TsL_2x:0",
    "What is the difference between validate and what-if?",
    "What is the difference between validate and what-if?\n\nValidate checks that the template is syntactically correct and will compile. What-if goes further and shows the actual resource changes against live Azure. (Validate catches errors; what-if shows impact.)",
  ],
  [
    "anki:C[w}30=@VI:0",
    "What are the three ways to deploy Bicep from Azure Pipelines?",
    "What are the three ways to deploy Bicep from Azure Pipelines?\n\nThe Bicep Deploy task (BicepDeploy@0), the ARM template deployment task (AzureResourceManagerTemplateDeployment@3), and an Azure CLI task running az deployment. (The Bicep Deploy task is the recommended option for new pipelines.)",
  ],
  [
    "anki:kr46s9NcHL:0",
    "What is the BicepDeploy@0 task, and why is it preferred?",
    "What is the BicepDeploy@0 task, and why is it preferred?\n\nA first-party Azure Pipelines task purpose-built for Bicep. It deploys .bicep and .bicepparam files directly without precompiling to JSON, and auto-downloads and caches the Bicep CLI. (The modern recommended approach, replacing the older CLI-task method.)",
  ],
  [
    "anki:Of$;o7{KMC:0",
    "What does the BicepDeploy@0 task support?",
    "What does the BicepDeploy@0 task support?\n\nStandard deployments at all four scopes, deployment stacks (with deny settings and actions on unmanaged resources), what-if previews, template validation, and output masking for secrets. (It is the all-in-one modern Bicep pipeline task.)",
  ],
  [
    "anki:H1supC_`1y:0",
    "What is a service connection in an Azure DevOps pipeline?",
    "What is a service connection in an Azure DevOps pipeline?\n\nThe configured link to your Azure subscription that the pipeline tasks run under, using a service principal's identity. (This is how the pipeline authenticates to Azure; ideally backed by workload identity federation so there is no stored secret.)",
  ],
] as const;
