
import { AWSCredentialsProvider } from "./AWSCredentialsProvider";
import { MedicalImagingClient  } from "@aws-sdk/client-medical-imaging";
import { StartDICOMImportJobCommand } from "@aws-sdk/client-medical-imaging";

interface ImportResponse {
    datastoreId: string,
    jobId: string,
    jobStatus: string,
    submittedAt: number
  }

interface ImporRequest {
    clientToken: string,
    dataAccessRoleArn: string,
    inputOwnerAccountId: string,
    inputS3Uri: string,
    jobName: string,
    outputS3Uri: string
}
  
  
export class AHIImporter {
    static  async importDICOMStudy(inputS3Uri: string, outputS3Uri: string, dataAccessRoleArn: string,  datastoreId: string, awsRegion: string) {
        //make the code loop 10 times until it can finally import the DICOM study
        let importResponse: ImportResponse;
        let retryCount = 0;
        while (retryCount < 10) {
            try {
                console.log((retryCount+1) +" - Starting DICOM import job for"+inputS3Uri);
                await this.startDICOMImportJob(inputS3Uri, outputS3Uri, dataAccessRoleArn,   datastoreId, awsRegion);
                break;
            } catch (error) {
                console.error('Error starting DICOM import job:', error);
                retryCount++;
                // Wait for 5 seconds before retrying
                await new Promise(resolve => setTimeout(resolve, 5000));
                if (retryCount >= 10) {
                    return false;
                }
            }
        }
        return true;
    }

    //function that request StartDICOMImportJob via AHI API
    static async startDICOMImportJob(inputS3Uri: string, outputS3Uri: string, dataAccessRoleArn: string, datastoreId: string,  awsRegion : string){
        try {
            let jobName= new Date().toISOString().replace(/[-:.]/g, '');
            // console.log("jobName: "+jobName);
            // console.log("datastoreId: "+datastoreId);
            // console.log("dataAccessRoleArn: "+dataAccessRoleArn);
            // console.log("inputS3Uri: "+inputS3Uri);
            // console.log("outputS3Uri: "+outputS3Uri);
            const client = new MedicalImagingClient({ region: awsRegion , credentials : await AWSCredentialsProvider.getInstance().getSigningCredentials() });
            const response = await client.send(
                new StartDICOMImportJobCommand({
                  jobName: jobName,
                  datastoreId: datastoreId,
                  dataAccessRoleArn: dataAccessRoleArn,
                  inputS3Uri: inputS3Uri,
                  outputS3Uri: outputS3Uri,
                }),
              );
              console.log(response);

        } catch (error) {
            console.error('Error:', error);
            throw error;
        }
        const responseData = {
            Message: 'Resource created successfully',
            Timestamp: new Date().toISOString()
        };
        return responseData;
    }
}
