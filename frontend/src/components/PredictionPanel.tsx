import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirestore, collection, query, orderBy, limit, onSnapshot, doc } from 'firebase/firestore';

interface Document {
  id: string;
  documentType: string;
  status: string;
}

interface Prediction {
  grade: number | string;
  current_percentage: number;
  letter_grade: string;
  max_possible_grade: number;
  min_possible_grade: number;
  reasoning: string;
  ai_prediction?: {
    grade: number | string;
    reasoning: string;
  };
  categorized_grades: {
    [category: string]: {
      completed: Array<{ name: string; grade: number }>;
      remaining: string[];
      average: number | null;
    };
  };
}

const PredictionPanel: React.FC = () => {
  const { currentUser } = useAuth();
  const [isPredicting, setIsPredicting] = useState<boolean>(false);
  const [predictionResult, setPredictionResult] = useState<Prediction | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  
  const functions = getFunctions();
  const db = getFirestore();

  // Memoize fetchDocuments with useCallback
  const fetchDocuments = useCallback(async () => {
    try {
      const getUserDocuments = httpsCallable(functions, 'getUserDocuments');
      const result = await getUserDocuments();
      
      if ((result.data as any).success) {
        setDocuments((result.data as any).documents || []);
      }
    } catch (err) {
      console.error('Error fetching documents:', err);
    }
  }, [functions]);

  // Listen for documents and predictions
  useEffect(() => {
    if (!currentUser) return;

    // Fetch documents initially
    fetchDocuments();

    // Listen for the latest prediction
    const userDocRef = doc(db, 'users', currentUser.uid);
    const predictionsRef = collection(userDocRef, 'predictions');
    const q = query(predictionsRef, orderBy('createdAt', 'desc'), limit(1));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const latestPrediction = snapshot.docs[0].data();
        if (latestPrediction.prediction) {
          setPredictionResult(latestPrediction.prediction);
        }
      }
    });

    return () => unsubscribe();
  }, [currentUser, db, fetchDocuments]);

  const handlePredict = async () => {
    // Check if we have enough documents
    const processedDocs = documents.filter(doc => doc.status === 'processed');
    if (processedDocs.length === 0) {
      setError('No processed documents found. Please upload at least one document first.');
      return;
    }

    setIsPredicting(true);
    setError(null);
    setStatus('Generating prediction...');

    try {
      // Call the predictGrades function
      const predictGrades = httpsCallable(functions, 'predictGrades');
      const result = await predictGrades({});
      
      const data = result.data as any;
      
      if (data.success && data.prediction) {
        setPredictionResult(data.prediction);
        setStatus('Prediction generated successfully!');
      } else {
        setError(data.message || 'Failed to generate prediction');
      }
    } catch (error: any) {
      console.error('Prediction error:', error);
      setError(error.message || 'An error occurred during prediction');
    } finally {
      setIsPredicting(false);
    }
  };

  // Determine if we can make a prediction based on document status
  const canPredict = documents.some(doc => doc.status === 'processed');
  
  // Get count of documents by type
  const docCounts = documents.reduce((acc: Record<string, number>, doc) => {
    acc[doc.documentType] = (acc[doc.documentType] || 0) + 1;
    return acc;
  }, {});

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Grade Prediction</h2>
      
      <div style={styles.documentSummary}>
        <h3>Available Documents</h3>
        <div style={styles.documentStats}>
          <div style={styles.statItem}>
            <span style={styles.statLabel}>Syllabus:</span>
            <span style={styles.statValue}>{docCounts.syllabus || 0}</span>
          </div>
          <div style={styles.statItem}>
            <span style={styles.statLabel}>Transcript:</span>
            <span style={styles.statValue}>{docCounts.transcript || 0}</span>
          </div>
          <div style={styles.statItem}>
            <span style={styles.statLabel}>Grades:</span>
            <span style={styles.statValue}>{docCounts.grades || 0}</span>
          </div>
          <div style={styles.statItem}>
            <span style={styles.statLabel}>Other:</span>
            <span style={styles.statValue}>{docCounts.other || 0}</span>
          </div>
        </div>
      </div>
      
      {error && <p style={styles.error}>{error}</p>}
      {status && <p style={styles.status}>{status}</p>}

      <div style={styles.predictSection}>
        <button 
          onClick={handlePredict} 
          disabled={isPredicting || !canPredict}
          style={canPredict ? styles.predictButton : styles.predictButtonDisabled}
        >
          {isPredicting ? 'Generating Prediction...' : 'Predict Grade'}
        </button>
        
        {!canPredict && documents.length > 0 && (
          <p style={styles.waitingMessage}>
            Waiting for document processing to complete...
          </p>
        )}
        
        {documents.length === 0 && (
          <p style={styles.noDocumentsMessage}>
            Please upload documents first to enable prediction
          </p>
        )}
      </div>

      {predictionResult && (
        <div style={styles.predictionResult}>
          <h3>Prediction Result</h3>
          <div style={styles.gradeDisplay}>
            <div style={styles.gradeCircle}>
              {predictionResult.letter_grade}
            </div>
            <div style={styles.gradePercentage}>
              {typeof predictionResult.current_percentage === 'number' 
                ? `${predictionResult.current_percentage.toFixed(1)}%`
                : predictionResult.current_percentage}
            </div>
            <div style={styles.gradeLabel}>Current Grade</div>
          </div>
          
          <div style={styles.gradeRangeSection}>
            <h4>Grade Range</h4>
            <div style={styles.gradeRange}>
              <div style={styles.rangeItem}>
                <span style={styles.rangeLabel}>Minimum:</span>
                <span style={styles.rangeValue}>{predictionResult.min_possible_grade.toFixed(1)}%</span>
              </div>
              <div style={styles.rangeItem}>
                <span style={styles.rangeLabel}>Maximum:</span>
                <span style={styles.rangeValue}>{predictionResult.max_possible_grade.toFixed(1)}%</span>
              </div>
            </div>
          </div>
          
          <div style={styles.reasoningSection}>
            <h4>Analysis</h4>
            <p style={styles.reasoning}>{predictionResult.reasoning}</p>
            {predictionResult.ai_prediction && (
              <div style={styles.aiPrediction}>
                <h4>AI Prediction</h4>
                <p>{predictionResult.ai_prediction.reasoning}</p>
              </div>
            )}
          </div>
          
          <div style={styles.categoriesSection}>
            <h4>Grade Breakdown by Category</h4>
            {Object.entries(predictionResult.categorized_grades).map(([category, data]) => (
              <div key={category} style={styles.categoryItem}>
                <h5 style={styles.categoryTitle}>{category}</h5>
                {data.average !== null && (
                  <div style={styles.categoryStats}>
                    <span style={styles.categoryAverage}>
                      Average: {data.average.toFixed(1)}%
                    </span>
                    <span style={styles.categoryProgress}>
                      Progress: {data.completed.length} completed, {data.remaining.length} remaining
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const baseStyles = {
  container: {
    padding: '20px',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  title: {
    marginTop: 0,
    color: '#333',
    borderBottom: '1px solid #eee',
    paddingBottom: '10px',
  },
  documentSummary: {
    marginBottom: '20px',
  },
  documentStats: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '15px',
    marginTop: '10px',
  },
  statItem: {
    backgroundColor: '#f5f5f5',
    padding: '10px 15px',
    borderRadius: '4px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    minWidth: '100px',
  },
  statLabel: {
    fontSize: '0.9rem',
    color: '#666',
    marginBottom: '5px',
  },
  statValue: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#333',
  },
  predictSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    margin: '20px 0',
  },
  predictButton: {
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    padding: '12px 30px',
    borderRadius: '4px',
    fontSize: '18px',
    cursor: 'pointer',
    fontWeight: 'bold',
    transition: 'background-color 0.3s',
  },
  predictButtonDisabled: {
    backgroundColor: '#cccccc',
    color: '#666666',
    border: 'none',
    padding: '12px 30px',
    borderRadius: '4px',
    fontSize: '18px',
    cursor: 'not-allowed',
    fontWeight: 'bold',
  },
  waitingMessage: {
    color: '#ff9800',
    marginTop: '10px',
    fontStyle: 'italic',
  },
  noDocumentsMessage: {
    color: '#666',
    marginTop: '10px',
    fontStyle: 'italic',
  },
  predictionResult: {
    padding: '20px',
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    marginTop: '20px',
  },
  gradeDisplay: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    marginBottom: '20px',
  },
  gradeCircle: {
    width: '120px',
    height: '120px',
    backgroundColor: '#4CAF50',
    borderRadius: '60px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    color: 'white',
    fontSize: '38px',
    fontWeight: 'bold',
    marginBottom: '10px',
  },
  gradeLabel: {
    fontSize: '16px',
    color: '#555',
  },
  reasoningSection: {
    marginBottom: '20px',
  },
  reasoning: {
    lineHeight: '1.6',
    color: '#333',
  },
  error: {
    color: '#f44336',
    backgroundColor: '#ffebee',
    padding: '10px',
    borderRadius: '4px',
    marginBottom: '15px',
  },
  status: {
    color: '#2196F3',
    backgroundColor: '#e3f2fd',
    padding: '10px',
    borderRadius: '4px',
    marginBottom: '15px',
  },
};

const styles = {
  ...baseStyles,
  gradePercentage: {
    fontSize: '24px',
    color: '#666',
    marginTop: '5px',
  },
  gradeRangeSection: {
    marginTop: '20px',
    padding: '15px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  gradeRange: {
    display: 'flex',
    justifyContent: 'space-around',
    marginTop: '10px',
  },
  rangeItem: {
    textAlign: 'center' as const,
  },
  rangeLabel: {
    display: 'block',
    color: '#666',
    fontSize: '14px',
    marginBottom: '5px',
  },
  rangeValue: {
    display: 'block',
    color: '#333',
    fontSize: '20px',
    fontWeight: 'bold',
  },
  aiPrediction: {
    marginTop: '15px',
    padding: '15px',
    backgroundColor: '#f5f5f5',
    borderRadius: '4px',
  },
  categoriesSection: {
    marginTop: '20px',
  },
  categoryItem: {
    padding: '15px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    marginBottom: '10px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  categoryTitle: {
    margin: '0 0 10px 0',
    color: '#333',
  },
  categoryStats: {
    display: 'flex',
    justifyContent: 'space-between',
    color: '#666',
  },
  categoryAverage: {
    fontWeight: 'bold',
  },
  categoryProgress: {
    fontSize: '14px',
  }
};

export default PredictionPanel;
