
import './AuthErrorModal.css'

interface AuthErrorModalProps {
    medream_url: string;
    onClose: () => void;
}

export const AuthErrorModal: React.FC<AuthErrorModalProps> = ({ medream_url, onClose }) => {
    const handleMedDreamClick = () => {
        window.open("https://"+medream_url , '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="overlay">
            <div className="modal">
                <div className="modal-header">
                    <h2 className="modal-title">Authentication Error</h2>
                </div>
                <div className="modal-content">
                    <p>Your MedDream viewer session is expired.</p>
                    <p> <span className="meddream-link" onClick={handleMedDreamClick}>Logon MedDream viewer and try to import the data again.</span></p>
                </div>
                <div className="modal-footer">
                    <button className="modal-button" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};