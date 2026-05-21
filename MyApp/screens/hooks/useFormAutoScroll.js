import { useRef } from "react";

export default function useFormAutoScroll(offset = 28) {
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const fieldRefs = useRef({});
  const inputPositions = useRef({});

  const registerInput = (key) => (event) => {
    inputPositions.current[key] = event.nativeEvent.layout.y;
  };

  const registerField = (key) => (ref) => {
    fieldRefs.current[key] = ref;
  };

  const scrollToInput = (key) => {
    const fieldRef = fieldRefs.current[key];

    setTimeout(() => {
      if (fieldRef && contentRef.current && scrollRef.current) {
        fieldRef.measureLayout(
          contentRef.current,
          (_x, y) => {
            scrollRef.current?.scrollTo({
              y: Math.max(0, y - offset),
              animated: true,
            });
          },
          (err) => {
            console.log("[registration scroll measure failed]", key, err);
          }
        );
        return;
      }

      const y = inputPositions.current[key] || 0;
      scrollRef.current?.scrollTo({
        y: Math.max(0, y - offset),
        animated: true,
      });
    }, 250);
  };

  return {
    scrollRef,
    contentRef,
    registerInput,
    registerField,
    scrollToInput,
  };
}
