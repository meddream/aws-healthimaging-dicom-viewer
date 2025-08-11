import { S3Client, PutObjectCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, UploadPartCommand, ChecksumAlgorithm } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { AWSCredentialsProvider } from "./AWSCredentialsProvider";



// Check if we're in a browser environment
const isBrowser = typeof window !== 'undefined';

if (isBrowser) {
  // Only run this code in browser environment
  import('buffer').then(({ Buffer }) => {
    window.Buffer = Buffer;
  });
  
  import('process').then((process) => {
    window.process = process;
  });
}


interface UploadResponse {
  success: boolean;
  message: string;
  key?: string;
  error?: any;
}


export class S3Uploader {
  private s3Client: S3Client;
  private bucket: string;

  constructor( bucket : string , awsRegion : string , accessKeyId : string , secretAccessKey : string, sessionToke : string | undefined ) {
    this.bucket = bucket;
    this.s3Client = new S3Client({
      region: awsRegion || 'us-east-1',
      credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey,
        sessionToken: sessionToke
      }
    });
  }

  private async multipartUpload(file: File, key: string): Promise<UploadResponse> {
    try {
      console.log("Starting multipart upload to ", key);
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.bucket,
          Key: key,
          Body: file,
          //ChecksumAlgorithm: ChecksumAlgorithm.CRC32
        },
        queueSize: 5, // Adjust the number of concurrent uploads
        partSize: 5 * 1024 * 1024, // 5MB per part
        leavePartsOnError: false
      });
      // Add progress monitoring
      upload.on("httpUploadProgress", (progress) => {
        const percentage = Math.round((progress.loaded || 0) / (progress.total || 1) * 100);
        console.log(`Upload progress: ${percentage}%`);
      });
      await upload.done();
      return {
        success: true,
        message: 'File uploaded successfully',
        key
      };
    } catch (error) {
      console.error('Multipart upload error:', error);
      throw error;
    }
  }

  private async standardUpload(file: File, key: string): Promise<UploadResponse> {
    try {
      console.log("Starting standard upload to ", key);
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file,
        ContentType: file.type,
        //ChecksumAlgorithm: ChecksumAlgorithm.CRC32
      });
      await this.s3Client.send(command);
      return {
        success: true,
        message: 'File uploaded successfully',
        key
      };
    } catch (error) {
      throw error;
    }
  }

  async uploadFile(file: File, prefix: string = ''): Promise<UploadResponse> {
    try {
      const key = prefix ? `${prefix}/${file.name}` : file.name;
      // For files larger than 5MB, use multipart upload
      if (file.size > 5 * 1024 * 1024) {
        return this.multipartUpload(file, key);
      }
      // For smaller files, use regular upload
      return this.standardUpload(file, key);
    } catch (error) {
      console.error('Upload error:', error);
      return {
        success: false,
        message: 'Upload failed',
        error
      };
    }
  }

  encodeFileToUTF8 = (file: File): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const encoder = new TextEncoder();
        const utf8Array = encoder.encode(text);
        resolve(utf8Array);
      };
      reader.onerror = (error) => {
        reject(error);
      };
      reader.readAsText(file);
    });
  };
}