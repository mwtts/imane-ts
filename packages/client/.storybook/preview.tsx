import type { Preview } from "@storybook/react-vite";
import { AppProvider } from "../src/context";
import "../src/styles.css";

const preview: Preview = {
  decorators: [
    (Story) => (
      <AppProvider>
        <Story />
      </AppProvider>
    ),
  ],
};

export default preview;
