import React, { useState } from "react";
import axios from "axios";
import {
  MAX_CONTENT_DESCRIPTION_LENGTH,
  MAX_CONTENT_TITLE_LENGTH,
  sanitizeContentDescription,
  sanitizeContentTitle,
  validateContentFields
} from "../contentTextUtils";

export default function UpdateGuideline({ guideline, onClose, onUpdated }) {
const [title, setTitle] = useState(sanitizeContentTitle(guideline.title));
const [description, setDescription] = useState(
  sanitizeContentDescription(guideline.description)
);
const [category, setCategory] = useState(guideline.category);
const [status, setStatus] = useState(guideline.status);
const [priorityLevel, setPriorityLevel] = useState(guideline.priorityLevel);

const BASE_URL = process.env.REACT_APP_API_URL || "https://gaganadapat.onrender.com";

const updateGuideline = async () => {
try {
const validationError = validateContentFields(title, description);

if (validationError) {
  alert(validationError);
  return;
}

const response = await axios.put(`${BASE_URL}${guideline._id}`, {
title: sanitizeContentTitle(title),
description: sanitizeContentDescription(description),
category,
status,
priorityLevel
});

  alert("Guideline updated successfully!");
  onUpdated(response.data);
  onClose();

} catch (error) {
  console.error(error.response?.data || error.message);
  alert("Failed to update guideline.");
}

}

return ( <div style={styles.overlay}> <div style={styles.modal}> <h2>Update Guideline</h2>

    <input
      style={styles.input}
      value={title}
      onChange={(e) => setTitle(sanitizeContentTitle(e.target.value))}
      maxLength={MAX_CONTENT_TITLE_LENGTH}
    />

    <textarea
      style={styles.input}
      value={description}
      onChange={(e) => setDescription(sanitizeContentDescription(e.target.value))}
      maxLength={MAX_CONTENT_DESCRIPTION_LENGTH}
    />

    <input
      style={styles.input}
      value={category}
      onChange={(e) => setCategory(e.target.value)}
    />

    <input
      style={styles.input}
      value={status}
      onChange={(e) => setStatus(e.target.value)}
    />

    <input
      style={styles.input}
      value={priorityLevel}
      onChange={(e) => setPriorityLevel(e.target.value)}
    />

    <button style={styles.button} onClick={updateGuideline}>
      Update
    </button>

    <button style={styles.cancel} onClick={onClose}>
      Cancel
    </button>
  </div>
</div>

);
}

const styles = {
overlay: {
position: "fixed",
top: 0,
left: 0,
width: "100%",
height: "100%",
backgroundColor: "rgba(0,0,0,0.5)",
display: "flex",
justifyContent: "center",
alignItems: "center"
},
modal: {
background: "white",
padding: 20,
borderRadius: 10,
width: 400
},
input: {
width: "100%",
padding: 10,
marginBottom: 10
},
button: {
backgroundColor: "#007bff",
color: "white",
padding: 10,
border: "none",
marginRight: 10,
cursor: "pointer"
},
cancel: {
backgroundColor: "#6c757d",
color: "white",
padding: 10,
border: "none",
cursor: "pointer"
}
}
