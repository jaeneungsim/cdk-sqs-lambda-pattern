exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    
    // Process SQS messages
    const results = [];
    
    for (const record of event.Records) {
        try {
            console.log(`Processing message: ${record.messageId}`);
            
            // Parse message body
            const messageBody = JSON.parse(record.body);
            console.log('Message body:', messageBody);
            
            // Different processing logic for lambda-2
            // Simulate more intensive processing
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const processedData = {
                messageId: record.messageId,
                receiptHandle: record.receiptHandle,
                processingTime: new Date().toISOString(),
                source: record.messageAttributes?.Source?.stringValue || 'unknown',
                requestId: record.messageAttributes?.RequestId?.stringValue || 'unknown',
                processedBy: 'sample-lambda-2',
                data: messageBody,
                enhanced: {
                    processingDelay: 100,
                    specialField: `enhanced-${record.messageId.slice(-6)}`,
                    timestamp: Date.now()
                }
            };
            
            console.log('Enhanced processing completed:', processedData);
            results.push(processedData);
            
        } catch (error) {
            console.error(`Error processing message ${record.messageId}:`, error);
            
            // Return batch item failure for this specific message
            results.push({
                itemIdentifier: record.messageId,
                error: error.message
            });
        }
    }
    
    console.log(`Processed ${results.length} messages from sample-lambda-2`);
    
    // Return batch item failures if any
    const failures = results.filter(result => result.error);
    if (failures.length > 0) {
        return {
            batchItemFailures: failures.map(failure => ({
                itemIdentifier: failure.itemIdentifier
            }))
        };
    }
    
    return {
        statusCode: 200,
        processedCount: results.length,
        results: results
    };
};