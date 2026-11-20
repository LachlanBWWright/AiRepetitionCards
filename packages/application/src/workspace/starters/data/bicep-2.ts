// CC BY 4.0; source, attribution and conversion details in ../README.md.
export default [
  [
    "anki:lTl^&kKA}&:0",
    "What agent version does the BicepDeploy@0 task require?",
    "What agent version does the BicepDeploy@0 task require?\n\nAgent software version 2.144.0 or later. Microsoft-hosted agents are always current; self-hosted agents you must keep updated. (A detail worth knowing if you run your own build agents, which is common in GCC High where hosted agents are not available.)",
  ],
  [
    "anki:liwT.G^G(j:0",
    "In a pipeline YAML, what does the trigger keyword do?",
    "In a pipeline YAML, what does the trigger keyword do?\n\nIt defines which branch pushes start the pipeline: trigger: - main runs on pushes to main. (The event that kicks off continuous deployment.)",
  ],
  [
    "anki:wfMx[.s[+T:0",
    "What is the 'pool' with vmImage in pipeline YAML?",
    "What is the 'pool' with vmImage in pipeline YAML?\n\nIt selects the agent to run on, for example vmImage: 'ubuntu-latest' for a Microsoft-hosted Linux agent. (Where the pipeline steps actually execute.)",
  ],
  [
    "anki:t]3>~F7?lh:0",
    "What is a deployment stack in Bicep?",
    "What is a deployment stack in Bicep?\n\nAn Azure resource that manages a group of resources as a single unit, with lifecycle control: update them together, and clean up resources removed from the template. (This is the successor to the deprecated Azure Blueprints; the through-line is deploy-and-manage-a-bundle.)",
  ],
  [
    "anki:go$b~fjq#c:0",
    "What are deny settings on a deployment stack?",
    "What are deny settings on a deployment stack?\n\nProtection that blocks out-of-band changes to the stack's managed resources: denySettingsMode: 'denyWriteAndDelete' stops anyone modifying or deleting them outside the stack. (This is the tamper-protection that carried over from Azure Blueprints' locking.)",
  ],
  [
    "anki:opsgDvM?Op:0",
    "What does actionOnUnmanageResources control in a deployment stack?",
    "What does actionOnUnmanageResources control in a deployment stack?\n\nWhat happens to resources removed from the template: 'delete' removes them, 'detach' leaves them in Azure but unmanaged. (Controls cleanup behavior when you take a resource out of the stack.)",
  ],
  [
    "anki:yR/]~?8*Rq:0",
    "How do you deploy a deployment stack with the BicepDeploy@0 task?",
    "How do you deploy a deployment stack with the BicepDeploy@0 task?\n\nSet type to 'deploymentStack' (instead of 'deployment') and provide the stack inputs like denySettingsMode and actionOnUnmanageResources. (Same task, different type value.)",
  ],
  [
    "anki:f,4i6NyZUp:0",
    "How do you convert existing ARM JSON to Bicep, and vice versa?",
    "How do you convert existing ARM JSON to Bicep, and vice versa?\n\naz bicep decompile turns ARM JSON into Bicep; az bicep build compiles Bicep to ARM JSON. (Decompile is how you migrate an old ARM estate onto Bicep, though the output usually needs cleanup.)",
  ],
  [
    "anki:k8/lnsmxPa:0",
    "What is the Bicep CLI, and how does it relate to the Azure CLI?",
    "What is the Bicep CLI, and how does it relate to the Azure CLI?\n\nThe Bicep CLI compiles and works with Bicep files. The Azure CLI bundles it and invokes it via az bicep; the Az PowerShell module does not bundle it, so there you install the Bicep CLI separately on the PATH.",
  ],
  [
    "anki:N.@?/fi&gV:0",
    "What does az bicep build do?",
    "What does az bicep build do?\n\nTranspiles a .bicep file into an ARM JSON template. (Usually happens automatically at deploy, but you can run it manually to inspect the generated ARM.)",
  ],
] as const;
