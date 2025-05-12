export interface Study {
    patientName: string;
    patientId : string;
    studyInstanceUID: string;
    studyDescription : string;
    studyDate: string;
    series: Series[];
  }
  
  export interface Series {
    seriesInstanceUID: string;
    seriesDescription: string;
    instances: Instance[];
  }
  
  export interface Instance {
    instanceUID: string;
    instanceNumber: number;
    file: File;
    uploaded : boolean;
  }
  
  export interface DICOMFileInfo {
    instanceUID: string;
    instanceNumber: number;
    seriesInstanceUID: string;
    seriesDescription: string;
    patientName: string;
    patientId : string;
    studyInstanceUID: string;
    studyDescription : string;
    studyDate: string;
  }


