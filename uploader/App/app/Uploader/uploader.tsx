import React, { useEffect, useState, type ChangeEvent, type DragEvent } from 'react';
import * as dcmjs from 'dcmjs';
import type { Study, Series, Instance, DICOMFileInfo } from './interfaces';
import './uploader.css';
import { S3Uploader } from './S3Upload';
import { AHIImporter } from './AHIImporter';
import { AuthErrorModal } from './AuthErrorModal';
import { AWSCredentialsProvider } from './AWSCredentialsProvider';
import { v4 as uuidv4 } from 'uuid';

interface FileItem {
  name: string;
  path: string;
  size: number;
}


interface StudyTableItem extends Study{
  checked: boolean,
  status : string,
}

async function loadDICOMFile(file: File) {

  let arrayBuffer = await file.arrayBuffer();
  let dicomData = dcmjs.data.DicomMessage.readFile(arrayBuffer);
  
  // Access DICOM attributes
  let patientName = dicomData.dict['00100010']?.Value[0].Alphabetic;
  let patientId = dicomData.dict['00100020']?.Value[0];
  let studyDescription = dicomData.dict['00081030']?.Value[0];
  let seriesDescription = dicomData.dict['0008103E']?.Value[0];
  let studyDate = dicomData.dict['00080020']?.Value[0];
  let StudyInstanceUID = dicomData.dict['0020000D']?.Value[0];
  let SeriesInstanceUID = dicomData.dict['0020000E']?.Value[0];
  let SOPInstanceUID = dicomData.dict['00080018']?.Value[0];
  let InstanceNumber = dicomData.dict['00200013']?.Value[0];

  
  let r: DICOMFileInfo = {
    instanceUID: SOPInstanceUID,
    instanceNumber: InstanceNumber,
    seriesInstanceUID: SeriesInstanceUID,
    seriesDescription: seriesDescription,
    patientName: patientName,
    patientId : patientId,
    studyInstanceUID: StudyInstanceUID,
    studyDescription : studyDescription,
    studyDate: studyDate
  }
  
  return r;
}

interface StudyTableProps {
  studies: StudyTableItem[];
  onStudySelect: (studyInstanceUID: string, checked: boolean) => void;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  itemsPerPage: number;
}

function StudyTable({ 
  studies, 
  onStudySelect, 
  currentPage, 
  setCurrentPage,
  itemsPerPage 
}: StudyTableProps) {
  
  const headers = [
      '',
      'Patient Name',
      'Patient ID',
      'Study Description',
      'Study Date',
      'Ser.',
      'Img.',
      'Status'
  ];

  // Calculate pagination
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentStudies = studies.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(studies.length / itemsPerPage);

  const handlePageChange = (newPage: number) => {
      setCurrentPage(newPage);
  };

  const getTotalInstances = (study: StudyTableItem) => {
      return study.series.reduce((total, series) => total + series.instances.length, 0);
  };

  return (
      <div>
          <table className="study-table">
              <thead>
                  <tr>
                      {headers.map((header, index) => (
                          <th key={index}>{header}</th>
                      ))}
                  </tr>
              </thead>
              <tbody>
                  {currentStudies.map((study) => (
                      <tr key={study.studyInstanceUID}>
                          <td>
                              <input 
                                  type="checkbox" 
                                  checked={study.checked} 
                                  onChange={(e) => onStudySelect(study.studyInstanceUID, e.target.checked)}
                              />
                          </td>
                          <td>{study.patientName}</td>
                          <td>{study.patientId}</td>
                          <td>{study.studyDescription}</td>
                          <td>{study.studyDate}</td>
                          <td>{study.series.length}</td>
                          <td>{getTotalInstances(study)}</td>
                          <td>{study.status}</td>
                      </tr>
                  ))}
              </tbody>
          </table>
          {totalPages > 1 && (
              <div className="pagination">
                  <button 
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="pagination-button pagination-button"
                  >
                      Previous
                  </button>
                  <span className="page-info">
                      Page {currentPage} of {totalPages}
                  </span>
                  <button 
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="pagination-button pagination-button"
                  >
                      Next
                  </button>
              </div>
          )}
      </div>
  );
}


export function Uploader() {
  const APP_VERSION="0.6";
  var tempStudies: StudyTableItem[] = []; // This one is used to construct the reprsentation of Studies/Series/Instances in memory.
  const [studies, setStudies] = useState<StudyTableItem[]>([]); //This one is used to display the representation on the view.
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isResetAvailable , setIsResetAvailable] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [showAuthError, setShowAuthError] = useState(false);
  const [authErrorMessage, setAuthErrorMessage] = useState(''); 
  var credentialProviderInstance : AWSCredentialsProvider = AWSCredentialsProvider.getInstance();


  const handleStudySelect = (studyInstanceUID: string, checked: boolean) => {
    setStudies(prevStudies => 
      prevStudies.map(study => 
        study.studyInstanceUID === studyInstanceUID 
          ? { ...study, checked: checked }
          : study
      )
    );
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isProcessing) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isProcessing) {
      setIsDragging(false);
    }
  };
  
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  
    if (isProcessing) return;

    setIsProcessing(true)
  
    const getAllFilesFromFolder = async (entry: FileSystemEntry): Promise<File[]> => {
      const files: File[] = [];
  
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        const file = await new Promise<File>((resolve) => {
          fileEntry.file((file) => resolve(file));
        });
        files.push(file);
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        const dirReader = dirEntry.createReader();
        const entries = await new Promise<FileSystemEntry[]>((resolve) => {
          dirReader.readEntries((entries) => resolve(entries));
        });
  
        for (const childEntry of entries) {
          const childFiles = await getAllFilesFromFolder(childEntry);
          files.push(...childFiles);
        }
      }
  
      return files;
    };
  
    try {
      const items = Array.from(e.dataTransfer.items);
      const filePromises = items
        .map(item => item.webkitGetAsEntry())
        .filter((entry): entry is FileSystemEntry => entry !== null)
        .map(entry => getAllFilesFromFolder(entry));
  
      const fileArrays = await Promise.all(filePromises);
      const allFiles = fileArrays.flat();
  
      // Convert File[] to FileList
      const dataTransfer = new DataTransfer();
      allFiles.forEach(file => dataTransfer.items.add(file));
      const fileList = dataTransfer.files;
  
      // Now you can use this fileList just like in handleFolderSelect
      const event = {
        target: {
          files: fileList
        }
      } as unknown as ChangeEvent<HTMLInputElement>;
  
      // Call handleFolderSelect with the converted fileList
      handleFolderSelect(event);
  
    } catch (error) {
      console.error('Error processing dropped folder:', error);
      setIsProcessing(false);
      setIsResetAvailable(true);
    }
  };

  const handleFolderSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    organizeStudies(files);
  };

  // Function to handle upload
  const handleUpload = async () => {
    setIsResetAvailable(false);
    setIsProcessing(true);

    //const credentialProviderInstance = await AWSCredentialsProvider.getInstance();
    let signingCredentials = await credentialProviderInstance.getSigningCredentials();
    if(signingCredentials.accessKeyId == "")
    {
      const currentUrl = window.location.host;
      setAuthErrorMessage(currentUrl);
      setShowAuthError(true);
      setIsProcessing(false);
      setIsResetAvailable(true);
      return
    }
    const uploader = new S3Uploader( credentialProviderInstance.app_config.source_bucket_name, credentialProviderInstance.app_config.region, (await signingCredentials).accessKeyId , (await signingCredentials).secretAccessKey , (await signingCredentials).sessionToken);
    const selectedStudies = studies.filter(study => study.checked);

    // Process one study at a time
    for (const study of selectedStudies) {
      try {
        let uniqueId = uuidv4(); 
        // Skip if study is already completed
        if (study.status === 'Completed') {
          continue;
        }
  
        // Update status to 'Uploading' for current study
        setStudies(prevStudies => 
          prevStudies.map(s => 
            s.studyInstanceUID === study.studyInstanceUID
              ? { ...s, status: 'Uploading (0%)' }
              : s
          )
        );
  
        // Collect all files that haven't been uploaded yet
        const pendingFiles = study.series.flatMap(series => 
          series.instances
            .filter(instance => !instance.uploaded) // Skip already uploaded files
            .map(instance => ({
              file: instance.file,
              instanceUID: instance.instanceUID
            }))
        );
  
        // If no files need uploading, mark study as completed
        if (pendingFiles.length === 0) {
          setStudies(prevStudies => 
            prevStudies.map(s => 
              s.studyInstanceUID === study.studyInstanceUID
                ? { ...s, status: 'Completed' }
                : s
            )
          );
          continue;
        }
  
        // Process files in batches of 10
        const batchSize = 10;
        let processedFiles = 0;
        const totalFiles = pendingFiles.length;
  
        for (let i = 0; i < pendingFiles.length; i += batchSize) {
          const batch = pendingFiles.slice(i, i + batchSize);
          
          await Promise.all(
            batch.map(async ({ file, instanceUID }) => {
              try {
                await uploader.uploadFile(file, uniqueId);
                processedFiles++;
                
                // Mark instance as uploaded
                setStudies(prevStudies => 
                  prevStudies.map(s => {
                    if (s.studyInstanceUID !== study.studyInstanceUID) return s;
                    
                    return {
                      ...s,
                      series: s.series.map(ser => ({
                        ...ser,
                        instances: ser.instances.map(inst => 
                          inst.instanceUID === instanceUID
                            ? { ...inst, uploaded: true }
                            : inst
                        )
                      })),
                      status: `Uploading (${Math.round((processedFiles / totalFiles) * 100)}%)`
                    };
                  })
                );
              } catch (error) {
                console.error(`Failed to upload file: ${file.name}`, error);
                //setIsResetAvailable(true);
              }
            })
          );
        }

        setStudies(prevStudies => 
          prevStudies.map(s => 
            s.studyInstanceUID === study.studyInstanceUID
              ? { ...s, status: 'Importing to AHI' }
              : s
          )
        );

       
        let source_prefix = "s3://"+credentialProviderInstance.app_config.source_bucket_name + "/" + uniqueId + "/";
        let output_prefix = "s3://"+credentialProviderInstance.app_config.output_bucket_name + "/" + uniqueId + "/";


        
      let import_status =  await AHIImporter.importDICOMStudy(source_prefix,output_prefix,credentialProviderInstance.app_config.ahi_import_role_arn, credentialProviderInstance.app_config.datastore_id, credentialProviderInstance.app_config.region);
      if (import_status == true){
        setStudies(prevStudies =>
          prevStudies.map(s =>
            s.studyInstanceUID === study.studyInstanceUID
              ? { ...s, status: 'AHI Import Submitted' }
              : s
          )
        );
      } else {
        setStudies(prevStudies =>
          prevStudies.map(s =>
            s.studyInstanceUID === study.studyInstanceUID
              ? { ...s, status: 'AHI Import Failed' }
              : s
          )
        );
      }
  
      } catch (error) {
        console.error(`Failed to upload study: ${study.studyInstanceUID}`, error);
        setStudies(prevStudies => 
          prevStudies.map(s => 
            s.studyInstanceUID === study.studyInstanceUID
              ? { ...s, status: 'Failed' }
              : s
          )
        );
      }
    }
    setIsResetAvailable(true);
  };;
  
  const handleReset = () => {
    // Clear the studies array
    setStudies([]);
    setCurrentPage(1)
    setIsProcessing(false);
    setIsResetAvailable(false);
};

  const hasSelectedStudies = () => {
    return studies.length > 0 && studies.some(study => study.checked);
  };

  async function organizeStudies(files: FileList | null) {
    setIsProcessing(true);
    if (!files){
      setIsProcessing(false);
      return;
    } 
  
    // Convert FileList to Array
    const fileArray = Array.from(files);
    tempStudies = [...studies];
  
    // Process files in chunks
    const chunkSize = 50; // Adjust this number based on performance testing
    const processChunk = async (startIndex: number) => {
      const chunk = fileArray.slice(startIndex, startIndex + chunkSize);
      
      // Process each file in the chunk
      const promises = chunk.map(async (file) => {
        try {
          const data = await loadDICOMFile(file);
          
          // Update studies state
          let alreadyListed = tempStudies.find(study => study.studyInstanceUID === data.studyInstanceUID);
          
          if (!alreadyListed) {
            let study: StudyTableItem = {
              checked: true,
              studyInstanceUID: data.studyInstanceUID,
              studyDescription: data.studyDescription,
              studyDate: data.studyDate,
              patientName: data.patientName,
              patientId: data.patientId,
              series: [],
              status: 'Not Uploaded'
            };
            
            let series: Series = {
              seriesInstanceUID: data.seriesInstanceUID,
              seriesDescription: data.seriesDescription,
              instances: []
            };
            
            let instance: Instance = {
              instanceUID: data.instanceUID,
              instanceNumber: data.instanceNumber,
              file: file,
              uploaded: false
            };
            
            series.instances.push(instance);
            study.series.push(series);
            tempStudies.push(study);
          } else {
            let alreadyListedSeries = alreadyListed.series.find(
              series => series.seriesInstanceUID === data.seriesInstanceUID
            );
            
            if (!alreadyListedSeries) {
              let series: Series = {
                seriesInstanceUID: data.seriesInstanceUID,
                seriesDescription: data.seriesDescription,
                instances: []
              };
              
              let instance: Instance = {
                instanceUID: data.instanceUID,
                instanceNumber: data.instanceNumber,
                file: file,
                uploaded: false
              };
              
              series.instances.push(instance);
              alreadyListed.series.push(series);
            } else {
              let alreadyListedInstance = alreadyListedSeries.instances.find(
                instance => instance.instanceUID === data.instanceUID
              );
              
              if (!alreadyListedInstance) {
                let instance: Instance = {
                  instanceUID: data.instanceUID,
                  instanceNumber: data.instanceNumber,
                  file: file,
                  uploaded: false
                };
                alreadyListedSeries.instances.push(instance);
              }
            }
          }
        } catch (error) {
          console.error('Error processing file:', file.name, error);
          setIsResetAvailable(true);
        }
      });
  
      await Promise.all(promises);
      setStudies([...tempStudies]);

      // Process next chunk if there are more files
      if (startIndex + chunkSize < fileArray.length) {
        // Use setTimeout to prevent UI blocking
        setTimeout(() => {
          processChunk(startIndex + chunkSize);
        }, 0);
      } else {
        // All chunks have been processed
        setIsProcessing(false);
        setIsResetAvailable(true);
      }
    };
  
    // Add loading state
    //setIsLoading(true);
  
    try {
      // Start processing first chunk
      await processChunk(0);
    } finally {
    }
  }

  async function handleModalClose() {
    await credentialProviderInstance.getCredentials();
    setShowAuthError(false);
    
  }

  return (
    <>
      <div className="header">
        <div className="logo-container">
          <img src="./meddream-logo.svg" alt="MedDream Logo" className="meddream-logo" />
          <img src="./aws-logo.png" alt="AWS Logo" className="aws-logo" />
        </div>
        <div className="version-label">
            v {APP_VERSION}
        </div>
      </div>
      <div className="folder-picker">
        <div 
            className={`drop-zone ${isDragging ? 'dragging' : ''} ${isProcessing ? 'processing' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
          <div className="drop-zone-content">
              {isProcessing ? (
                <p>Processing files...</p>
              ) : (
                <>
                  <p>Drag and drop DICOM files here</p>
                  <p>or</p>
                  <div className="input-container">
                    <input
                      type="file"
                      webkitdirectory=""
                      directory=""
                      onChange={handleFolderSelect}
                      disabled={isProcessing}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="upload-button-container">
            <span  style={{ marginRight: '10px' }}>
            <button className="upload-button" disabled={!hasSelectedStudies()|| isProcessing} onClick={handleUpload}>
                Import to AWS HealthImaging
              </button>         
            </span>
            <span>
            <button className="upload-button" disabled={!isResetAvailable} onClick={handleReset}>
                Reset
              </button>
            </span>
          </div>
          <div className="study-table-container">
          <StudyTable studies={studies} onStudySelect={handleStudySelect} currentPage={currentPage} itemsPerPage={itemsPerPage} setCurrentPage={setCurrentPage}/>
          </div>
      </div>
      {showAuthError && (
            <AuthErrorModal
                medream_url={authErrorMessage}
                onClose={() => {
                  handleModalClose();
                }}
            />
        )}
    </>
  );
}


