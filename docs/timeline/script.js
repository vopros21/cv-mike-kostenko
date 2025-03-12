document.addEventListener('DOMContentLoaded', function() {
    const dateItems = document.querySelectorAll('.date-item');
    const previewContent = document.getElementById('preview-content');
    const documentTabs = document.createElement('div');
    documentTabs.className = 'document-tabs';
    const documentPreviewArea = document.createElement('div');
    documentPreviewArea.className = 'document-preview-area';
    
    // Clear and set up the preview content structure
    previewContent.innerHTML = '';
    previewContent.appendChild(documentTabs);
    previewContent.appendChild(documentPreviewArea);
    
    dateItems.forEach(item => {
        item.addEventListener('click', function() {
            // Remove active class from all items
            dateItems.forEach(i => i.classList.remove('active'));
            
            // Add active class to clicked item
            this.classList.add('active');
            
            // Get the files data from the data-files attribute
            const filesData = JSON.parse(this.getAttribute('data-files'));
            
            // Clear previous tabs
            documentTabs.innerHTML = '';
            
            // Create tabs for each document
            filesData.forEach((doc, index) => {
                const tab = document.createElement('div');
                tab.className = 'document-tab';
                tab.dataset.index = index;
                
                const iconText = doc.type === 'pdf' ? '📄' : '🖼️';
                
                tab.innerHTML = `
                    <span class="document-icon">${iconText}</span>
                    <span>${doc.title}</span>
                `;
                
                documentTabs.appendChild(tab);
                
                // Add click event to tab
                tab.addEventListener('click', function() {
                    // Remove active class from all tabs
                    document.querySelectorAll('.document-tab').forEach(
                        t => t.classList.remove('active')
                    );
                    
                    // Add active class to clicked tab
                    this.classList.add('active');
                    
                    // Get the document index
                    const docIndex = parseInt(this.dataset.index);
                    const selectedDoc = filesData[docIndex];
                    
                    // Clear preview area
                    documentPreviewArea.innerHTML = '';
                    
                    // Display the document based on type
                    if (selectedDoc.type === 'pdf') {
                        const iframe = document.createElement('iframe');
                        iframe.src = `files/${selectedDoc.file}`;
                        iframe.setAttribute('type', 'application/pdf');
                        documentPreviewArea.appendChild(iframe);
                    } else if (selectedDoc.type === 'image') {
                        const img = document.createElement('img');
                        img.src = `files/${selectedDoc.file}`;
                        img.alt = selectedDoc.title;
                        documentPreviewArea.appendChild(img);
                    }
                });
            });
            
            // Automatically select the first document
            if (filesData.length > 0) {
                documentTabs.querySelector('.document-tab').click();
            } else {
                documentPreviewArea.innerHTML = '<p class="no-preview">No documents available for this date</p>';
            }
        });
    });
    
    // Automatically select the first date item on page load
    if (dateItems.length > 0) {
        dateItems[0].click();
    } else {
        documentPreviewArea.innerHTML = '<p class="no-preview">No dates available in the timeline</p>';
    }
});
