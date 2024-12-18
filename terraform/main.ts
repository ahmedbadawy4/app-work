import { Construct } from "constructs";
import { App, TerraformStack, TerraformOutput, CloudBackend, NamedCloudWorkspace, } from "cdktf";
import { GoogleProvider } from "@cdktf/provider-google/lib/provider";
import { ContainerCluster } from "@cdktf/provider-google/lib/container-cluster";
import { SqlDatabaseInstance } from "@cdktf/provider-google/lib/sql-database-instance";
import { ComputeNetwork } from "@cdktf/provider-google/lib/compute-network";
import { ComputeFirewall } from "@cdktf/provider-google/lib/compute-firewall";
import { ComputeSubnetwork } from "@cdktf/provider-google/lib/compute-subnetwork";
import { ServiceAccount } from "@cdktf/provider-google/lib/service-account";
import { ComputeGlobalAddress } from "@cdktf/provider-google/lib/compute-global-address";
import { ServiceNetworkingConnection } from "@cdktf/provider-google/lib/service-networking-connection";
import { ProjectIamBinding } from "@cdktf/provider-google/lib/project-iam-binding";
import { Variables } from "./variables";
import { DataSources } from "./data-sources";
// import { VpcAccessConnector } from "@cdktf/provider-google/lib/vpc-access-connector";

class MyStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    //variables
    const vars = new Variables(this);

    //data-sources
    const dataSources = new DataSources(this, vars.projectId.value);

    // pick the environment from the variables
    if (vars.environment.value == "production") {
      new CloudBackend(this, {
        hostname: "app.terraform.io",
        organization: "prod-organization",
        workspaces: new NamedCloudWorkspace("production"),
      });
    } else if (vars.environment.value === "development") {
      new CloudBackend(this, {
        hostname: "app.terraform.io",
        organization: "staging-organization",
        workspaces: new NamedCloudWorkspace("development"),
      });
    }

    //provider
    new GoogleProvider(this, "Google", {
      region: vars.region.value,
      project: vars.projectId.value,
    });

    //resources

    //vpc
    const network = new ComputeNetwork(this, "Network", {
      name: `${dataSources.projectData.name}-vpc`, //diffrent way to get project name
      autoCreateSubnetworks: false,
    });

    //subnet
    const subnet = new ComputeSubnetwork(this, "Subnet", {
      name: `${vars.projectId.value}-subnet`,
      ipCidrRange: "10.0.0.0/16",
      region: "europe-west3",
      network: network.id,
      privateIpGoogleAccess: true,
      logConfig: {
        aggregationInterval: "INTERVAL_5_MIN",
        flowSampling: 0.5,
        metadata: "INCLUDE_ALL_METADATA",
        metadataFields: ["PROJECT_ID", "INSTANCE_ID", "ZONE", "INSTANCE_NAME"],
      },
    });

    // // Create a private services access connection
    // const vpcAccessConnector = new VpcAccessConnector(this, "VpcAccessConnector", {
    //   name: "sisu-project-vpc-connector",
    //   region: "us-central1",
    //   network: network.id,
    //   ipCidrRange: "10.8.0.0/28", // Choose a CIDR block in your VPC range
    // });

    //global address
    const globalAddress = new ComputeGlobalAddress(this, "GlobalAddress", {
      name: `${dataSources.projectData.name}-reserved-range`,
      purpose: "VPC_PEERING",
      addressType: "INTERNAL",
      prefixLength: 16,
      network: network.id,
    });

    //vpc peering
    new ServiceNetworkingConnection(this, "VpcPeering", {
      network: network.id,
      service: "servicenetworking.googleapis.com",
      reservedPeeringRanges: [globalAddress.name],
    });

    //postgres sql instance
    const sqlInstance = new SqlDatabaseInstance(this, "SQLInstance", {
      name: `${dataSources.projectData.name}-sql-instance`,
      region: vars.region.value,
      databaseVersion: "POSTGRES_16",
      deletionProtection: false,
      settings: {
        tier: "db-f1-micro",
        backupConfiguration: {
          enabled: true,
        },
        databaseFlags: [
          {
          name: "log_duration",
          value: "on",
        },
        {
          name: "log_statement",
          value: "all",
        },
        {
          name: "log_min_messages",
          value: "ERROR",
        },
        {
          name: "log_level",
          value: "ERROR",
        },
        {
          name: "log_connections",
          value: "on",
        },
        {
          name: "log_disconnections",
          value: "on",
        },
        {
          name: "log_lock_waits",
          value: "on",
        },
        {
          name: "log_temp_files",
          value: "0",
        },
        {
          name: "log_autovacuum_min_duration",
          value: "0",
        },
        {
          name: "log_checkpoints",
          value: "on",
        },
        {
          name: "log_line_prefix",
          value: "%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h ",
        },
        {
          name: "log_timezone",
          value: "UTC",
        },
        {
          name: "log_hostname",
          value: "on",
        },
        {
          name: "audit_log",
          value: "on",
        },
      ],
        ipConfiguration: {
          ipv4Enabled: false,
          privateNetwork: `projects/digital-seat-441309-j5/global/networks/${network.name}`,
          sslMode: "TRUSTED_CLIENT_CERTIFICATE_REQUIRED",
          authorizedNetworks: [
            {
              name: "VPN Access 2",
              value: "19.104.105.29/32",
            },
            // {
            //   name: "VPN Access 1",
            //   value: "10.26.32.12/32",
            // },
            // already automatically included in networks authorized by Cloud SQL, and can't be added again. Learn more: https://cloud.google.com/sql/docs/mysql/authorize-networks#limitations.
          ],
        },
      },
    });

    //GKE service account
    const gkeServiceAccount = new ServiceAccount(this, "GkeServiceAccount", {
      accountId: `${dataSources.projectData.name}-gke-sa`,
      displayName: `${dataSources.projectData.name} GKE Service Account`,
      project: dataSources.projectData.projectId,
    });

    //iam bindings
    new ProjectIamBinding(this, "IamBinding", {
      project: dataSources.projectData.projectId,
      role: "roles/cloudsql.client",
      members: [`serviceAccount:${gkeServiceAccount.email}`],
    });
    new ProjectIamBinding(this, "IamBindingVpcAccessAdmin", {
      project: dataSources.projectData.projectId,
      role: "roles/vpcaccess.admin",
      members: [
        `serviceAccount:terraform-cdk-sa@${dataSources.projectData.projectId}.iam.gserviceaccount.com`,
      ],
    });
    new ProjectIamBinding(this, "IamBindingServiceAccountUser", {
      project: dataSources.projectData.projectId,
      role: "roles/iam.serviceAccountUser",
      members: [
        `serviceAccount:terraform-cdk-sa@${dataSources.projectData.projectId}.iam.gserviceaccount.com`,
      ],
    });

    // GKE Cluster
    const cluster = new ContainerCluster(this, "GKECluster", {
      name: `${dataSources.projectData.name}-gke-cluster`,
      enableIntranodeVisibility: true,
      network: network.id,
      subnetwork: subnet.id,
      initialNodeCount: 1,
      deletionProtection: false,
      networkPolicy:{
          enabled: true,
        },
      nodeConfig: {
        machineType: "e2-micro",
        diskSizeGb: 20,
        serviceAccount: gkeServiceAccount.email,
        },
    });

    //firewall
    new ComputeFirewall(this, "VPNAccessFirewall", {
      name: "allow-vpn-access",
      network: network.id,
      allow: [
        {
          protocol: "tcp",
          ports: ["443"], // HTTPS
        },
      ],
      sourceRanges: ["62.65.233.178"], // "0.0.0.0/0", commented and replaced with specific IP
      disabled: false,
    });

    new ComputeFirewall(this, "ClusterVPNAccess", {
      name: "vpn-access",
      network: network.id,
      deny: [
        {
          protocol: "all",
        },
      ],
      sourceRanges: ["10.26.32.12/32", "19.104.105.29/32"],
      disabled: false,
    });

    //outputs
    new TerraformOutput(this, "CloudSQLPrivateIP", {
      value: sqlInstance.privateIpAddress,
    });
    new TerraformOutput(this, "GKEClusterID", {
      value: cluster.id,
    });

    //debug
    console.log("Cloud SQL Private IP:", sqlInstance.privateIpAddress);
    console.log("GKE Cluster ID:", cluster.id);
  }
}

const app = new App();
new MyStack(app, "terraform");
app.synth();
